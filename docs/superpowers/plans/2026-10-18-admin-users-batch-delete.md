# 用户多选与批量删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 站主可在 `/admin/users` 当前页多选普通账号并永久删除（级联清除其全部数据）。

**Architecture:** 新增 `POST /api/v1/admin/users/batch-delete`，service 用 `SELECT … ORDER BY id FOR UPDATE` 锁定目标行后单语句 `DELETE`，依靠既有 `ON DELETE CASCADE` 清理全部关联数据；含站主整批 409。前端 `lib/api/admin-users.ts` 增加 `deleteAdminUsers`，页面增加复选框列、选择操作栏和需输入「删除」的确认对话框。

**Tech Stack:** FastAPI / Pydantic 2 / SQLAlchemy 2（同步）/ pytest；SvelteKit 3 + Svelte 5 runes / Vitest / Playwright（合成 API）。

**Spec:** `docs/superpowers/specs/2026-10-18-admin-users-batch-delete-design.md`

## Global Constraints

- 不新增迁移、不改数据库结构；不改既有接口的请求/响应。
- 请求体继承 `StrictInput`；`ids` 为 1–100 个互不重复的 UUID（`Annotated[UUID, Field(strict=False)]`，沿用 `ActivityBatchDelete`）。
- 响应形状 `{"deleted": true, "deleted_count": n}`，与 `POST /api/v1/activities/batch-delete` 一致。
- 错误：含站主 → `ApiError(409, "OWNER_PROTECTED", "不能删除站主账号")`；不存在的 ID 静默忽略。
- 权限：`require_admin_write`（站主 + CSRF/Origin）；router 在 service 后 `db.commit()`，service 只 `flush()`。
- 前端：`#lib/...` 带 `.ts` 导入；runes；不使用 store/`createEventDispatcher`；保留 `disposed` 与请求令牌；401 跳转 `/admin?reason=expired`。
- 颜色只用语义令牌（`--error` / `--error-soft` / `--error-border` / `--border` / `--surface`），不硬编码色值。
- **不执行 `git commit`**（AGENTS.md §11 未获授权）；每个任务结束用 `git diff --stat` 核对改动范围。
- 集成测试只在 `_test` 库运行，变量只注入进程环境，不改 `.env`；未配置时集成用例跳过，**跳过不等于通过**。

### 集成测试命令（backend/ 下执行，后文记为「运行集成测试 <路径>」）

```bash
.venv/bin/python - "$@" <<'PY'
import os, subprocess, sys
from sqlalchemy.engine import make_url
from app.core.config import Settings
url = make_url(Settings().database_url).set(database="running_note_phase_one_test")
env = {**os.environ,
       "TEST_DATABASE_URL": url.render_as_string(hide_password=False),
       "TEST_DATABASE_ALLOWED_TARGETS": f"{url.host}:{url.port or 5432}/{url.database}"}
raise SystemExit(subprocess.run([".venv/bin/pytest", "-q", "--tb=short", *sys.argv[1:]], env=env).returncode)
PY
```

调用方式：把上面脚本中 `"$@"` 处替换为测试路径，例如 `.venv/bin/python - tests/integration/test_admin_users.py <<'PY' … PY`。不要打印 env 或 DSN。

---

### Task 1: 后端批量删除接口

**Files:**
- Modify: `backend/app/modules/admin_users/schema.py`
- Modify: `backend/app/modules/admin_users/service.py`
- Modify: `backend/app/modules/admin_users/router.py`
- Test: `backend/tests/unit/test_admin_users.py`

**Interfaces:**
- Produces: `UserBatchDelete`（`ids: list[UUID]`）、`UserBatchDeleteResult`（`deleted: bool`, `deleted_count: int`）、`service.delete_many(db, identifiers: list[UUID], settings) -> dict`、路由 `POST /api/v1/admin/users/batch-delete`。

- [ ] **Step 1: 写失败的单元测试**（追加到 `backend/tests/unit/test_admin_users.py` 末尾；文件顶部已有 `pytest`、`Mock`、`SimpleNamespace`、`uuid4`、`ApiError` 与 `user()` 辅助函数）

```python
from pydantic import ValidationError

from app.modules.admin_users import service as admin_service
from app.modules.admin_users.schema import UserBatchDelete

DUPLICATE = str(uuid4())


@pytest.mark.parametrize(
    "payload",
    [
        {"ids": []},
        {"ids": [DUPLICATE, DUPLICATE]},
        {"ids": [str(uuid4()) for _ in range(101)]},
        {"ids": ["not-a-uuid"]},
        {"ids": [str(uuid4())], "confirm": "删除"},
    ],
)
def test_batch_delete_rejects_invalid_payloads(payload):
    with pytest.raises(ValidationError):
        UserBatchDelete.model_validate(payload)


def test_batch_delete_accepts_uuid_strings():
    identifier = uuid4()
    assert UserBatchDelete.model_validate({"ids": [str(identifier)]}).ids == [identifier]


def test_delete_many_refuses_owner_without_deleting():
    owner = user()
    settings = SimpleNamespace(site_owner_email=owner.email_normalized)
    db = Mock()
    db.scalars.return_value.all.return_value = [owner]
    with pytest.raises(ApiError) as error:
        admin_service.delete_many(db, [owner.id], settings)
    assert error.value.status_code == 409 and error.value.code == "OWNER_PROTECTED"
    db.execute.assert_not_called()


def test_delete_many_ignores_missing_and_counts_locked_rows():
    person = user()
    settings = SimpleNamespace(site_owner_email="owner@example.com")
    db = Mock()
    db.scalars.return_value.all.return_value = [person]
    result = admin_service.delete_many(db, [person.id, uuid4()], settings)
    assert result == {"deleted": True, "deleted_count": 1}
    db.execute.assert_called_once()
```

把新增的 `import` 移到文件顶部 import 区，保持 Ruff `I` 排序。

- [ ] **Step 2: 运行确认失败**

Run（backend/）：`.venv/bin/pytest tests/unit/test_admin_users.py -q`
Expected: FAIL，`ImportError: cannot import name 'UserBatchDelete'`。

- [ ] **Step 3: 实现 schema**（`schema.py`：顶部补 `from typing import Annotated`、`from uuid import UUID`，文件末尾追加）

```python
class UserBatchDelete(StrictInput):
    ids: list[Annotated[UUID, Field(strict=False)]] = Field(min_length=1, max_length=100)

    @field_validator("ids")
    @classmethod
    def unique_ids(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("User ids must be unique")
        return value


class UserBatchDeleteResult(StrictInput):
    deleted: bool = True
    deleted_count: int
```

- [ ] **Step 4: 实现 service**（`service.py`：`from sqlalchemy import delete, func, or_, select, update`，文件末尾追加）

```python
def delete_many(db, identifiers, settings):
    # Fixed lock order avoids deadlocks with concurrent imports and edits.
    users = db.scalars(
        select(User).where(User.id.in_(identifiers)).order_by(User.id).with_for_update()
    ).all()
    if any(is_admin(user, settings) for user in users):
        raise ApiError(409, "OWNER_PROTECTED", "不能删除站主账号")
    if users:
        # Database ON DELETE CASCADE removes records, raw files, reports, goals and sessions.
        db.execute(delete(User).where(User.id.in_([user.id for user in users])))
    db.flush()
    return {"deleted": True, "deleted_count": len(users)}
```

- [ ] **Step 5: 实现 router**（`router.py`：import 列表补 `UserBatchDelete, UserBatchDeleteResult`，在 `create` 之后追加）

```python
@router.post("/batch-delete", response_model=ApiResponse[UserBatchDeleteResult])
def batch_delete(payload: UserBatchDelete, request: Request, db: DB, identity: Write):
    data = service.delete_many(db, payload.ids, request.app.state.settings)
    db.commit()
    return envelope(request, data)
```

- [ ] **Step 6: 运行单元测试与代码检查**

Run（backend/）：
```bash
.venv/bin/pytest tests/unit -q
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
```
Expected: 全部通过；如格式检查失败先 `.venv/bin/ruff format <文件>` 再复查。

- [ ] **Step 7: 核对改动**：`git diff --stat`，只应出现上述 4 个文件（及此前已存在的未提交改动）。不提交。

---

### Task 2: 后端集成测试（级联、保护、权限、AI 竞态）

**Files:**
- Modify: `backend/tests/integration/test_admin_users.py`
- Modify: `backend/tests/integration/test_ai_reports.py`

**Interfaces:**
- Consumes: Task 1 的 `POST /api/v1/admin/users/batch-delete`；既有 fixture `site`（返回 `admin, visitor, old, admin_headers, owner_activity, _, engine, settings, _`）、`login()`、`write_headers()`、`PASSWORD`、`ORIGIN`；`test_ai_reports.py` 的 `ai_clients`、`register`、`seed`、`post`、`MockProvider`。

- [ ] **Step 1: 写批量删除集成测试**（追加到 `test_admin_users.py`；顶部 import 补 `from sqlalchemy import func, select`、`from app.modules.activities.model import Activity`、`from app.modules.auth.model import AuthSession`、`from app.modules.gpx.model import GpxImport`）

```python
def test_batch_delete_cascades_protects_owner_and_requires_admin(site, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, _, admin_headers, _, _, _, settings, _ = site
    prefix = "/api/v1/admin/users"
    endpoint = prefix + "/batch-delete"
    owner_id = admin.get("/api/v1/me").json()["data"]["id"]
    accounts = []
    for tag in ("a", "b"):
        suffix = uuid4().hex[:18]
        payload = dict(
            email=f"bulk-{tag}-{suffix}@example.com",
            username=f"b{tag}_{suffix}",
            display_name="合成批量删除",
            timezone="UTC",
            password=PASSWORD,
        )
        created = admin.post(prefix, json=payload, headers=admin_headers)
        assert created.status_code == 201, created.text
        accounts.append((created.json()["data"]["id"], payload))
    (first, first_payload), (second, second_payload) = accounts
    raw = (Path(__file__).parents[1] / "fixtures/gpx/equator-six.gpx").read_bytes()
    with (
        TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as one,
        TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as two,
    ):
        logged = login(one, first_payload["email"])
        assert logged.status_code == 200, logged.text
        headers = write_headers(logged)
        upload = one.post(
            "/api/v1/gpx-imports",
            headers=headers,
            files={"file": ("synthetic.gpx", raw, "application/gpx+xml")},
        )
        assert upload.status_code == 201, upload.text
        record = upload.json()["data"]["activity"]["id"]
        share = one.post(f"/api/v1/activities/{record}/shares", json={}, headers=headers)
        assert share.status_code == 201
        shared = "/api/v1/shared/" + share.json()["data"]["share_url"].rsplit("/", 1)[1]
        assert visitor.get(shared).status_code == 200

        other = login(two, second_payload["email"])
        assert other.status_code == 200
        assert (
            two.post(endpoint, json={"ids": [first]}, headers=write_headers(other)).status_code
            == 403
        )
        assert admin.post(endpoint, json={"ids": [first]}).status_code == 403

        protected = admin.post(endpoint, json={"ids": [first, owner_id]}, headers=admin_headers)
        assert protected.status_code == 409
        assert protected.json()["error"]["code"] == "OWNER_PROTECTED"
        assert one.get("/api/v1/me").status_code == 200

        missing = str(uuid4())
        deleted = admin.post(
            endpoint, json={"ids": [first, second, missing]}, headers=admin_headers
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["data"] == {"deleted": True, "deleted_count": 2}
        assert one.get("/api/v1/me").status_code == 401
        assert two.get("/api/v1/me").status_code == 401
        assert visitor.get(shared).status_code == 404
        again = admin.post(endpoint, json={"ids": [first]}, headers=admin_headers)
        assert again.json()["data"] == {"deleted": True, "deleted_count": 0}

    with admin.app.state.session_factory() as db:
        removed = [UUID(first), UUID(second)]
        for model in (User, Activity, GpxImport, AuthSession):
            column = model.id if model is User else model.user_id
            count = db.scalar(select(func.count()).select_from(model).where(column.in_(removed)))
            assert count == 0, model.__name__
        assert db.get(User, UUID(owner_id)) is not None
```

顶部 import 同时补 `from uuid import UUID, uuid4`（原为 `from uuid import uuid4`）。

- [ ] **Step 2: 写 AI 竞态测试**（追加到 `test_ai_reports.py`；import 补 `from sqlalchemy import delete, func, select` 与 `from app.modules.ai_reports.model import AIReport`）

```python
def test_report_finishing_after_account_deletion_fails_safely(ai_clients):
    a, _, app, provider = ai_clients
    owner = register(a)
    seed(app, owner)
    provider.release = threading.Event()
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(post, a)
        assert provider.entered.wait(5)
        # Same cascade the admin batch delete performs, while the provider call is in flight.
        with app.state.session_factory.begin() as db:
            db.execute(delete(User).where(User.id == UUID(owner)))
        provider.release.set()
        response = pending.result()
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_TIMEOUT"
    with app.state.session_factory() as db:
        remaining = db.scalar(
            select(func.count()).select_from(AIReport).where(AIReport.user_id == UUID(owner))
        )
        assert remaining == 0
```

- [ ] **Step 3: 运行集成测试**

Run（backend/）：用「运行集成测试」脚本，参数 `tests/integration/test_admin_users.py tests/integration/test_ai_reports.py`。
Expected: 全部 PASS。若输出为 `skipped`，说明测试库变量未生效——记录为「未运行」，不要报告通过。若 `test_report_finishing_after_account_deletion_fails_safely` 返回 500，停止并报告（说明 AI 模块需要额外处理，需先与用户确认再改 `ai_reports/service.py`）。

- [ ] **Step 4: Ruff**：`.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests`，Expected: 通过。

- [ ] **Step 5: 核对改动**：`git diff --stat`。不提交。

---

### Task 3: 前端接口层与合成 API

**Files:**
- Modify: `frontend/src/lib/api/admin-users.ts`
- Modify: `frontend/tests/fixtures/ui-api.mjs`
- Test: `frontend/tests/unit/admin-users.test.ts`

**Interfaces:**
- Consumes: Task 1 接口。
- Produces: `deleteAdminUsers(ids: string[], fetcher?: typeof fetch): Promise<number>`（返回实际删除数）；合成 API 支持 `POST /api/v1/admin/users/batch-delete`。

- [ ] **Step 1: 写失败的单元测试**（`admin-users.test.ts`：import 补 `deleteAdminUsers`，在 `describe` 内追加）

```ts
  it('deletes a validated batch with fresh CSRF and checks the acknowledgement', async () => {
    const other = '00000000-0000-4000-8000-000000000456';
    const fetcher = vi.fn().mockResolvedValueOnce(response({ csrf_token: 'bulk-csrf' })).mockResolvedValueOnce(response({ deleted: true, deleted_count: 2 }));
    expect(await deleteAdminUsers([user.id, other], fetcher)).toBe(2);
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe('/api/v1/admin/users/batch-delete');
    expect(init.method).toBe('POST');
    expect(init.headers['X-CSRF-Token']).toBe('bulk-csrf');
    expect(JSON.parse(init.body)).toEqual({ ids: [user.id, other] });
    for (const body of [{ deleted: false, deleted_count: 2 }, { deleted: true, deleted_count: 3 }, { deleted: true, deleted_count: -1 }, { deleted: true }]) {
      const malformed = vi.fn().mockResolvedValueOnce(response({ csrf_token: 'x' })).mockResolvedValueOnce(response(body));
      await expect(deleteAdminUsers([user.id, other], malformed)).rejects.toThrow('用户管理服务返回了无效响应');
    }
  });
  it('rejects empty, oversized, duplicate or malformed batches before any request', async () => {
    const fetcher = vi.fn();
    const many = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    for (const ids of [[], many, [user.id, user.id], ['../other']]) await expect(deleteAdminUsers(ids, fetcher)).rejects.toMatchObject({ status: 422 });
    expect(fetcher).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行确认失败**

Run（frontend/）：`pnpm exec vitest run tests/unit/admin-users.test.ts`
Expected: FAIL，`deleteAdminUsers is not a function` / 导出不存在。

- [ ] **Step 3: 实现接口函数**（`admin-users.ts` 文件末尾追加）

```ts
export async function deleteAdminUsers(ids: string[], fetcher: typeof fetch = fetch): Promise<number> {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id))) throw new AdminUserError('请选择 1–100 个不同的用户', 422, 'VALIDATION_ERROR');
  const value = await write('/api/v1/admin/users/batch-delete', 'POST', { ids }, fetcher);
  if (!object(value) || value.deleted !== true || !Number.isInteger(value.deleted_count) ||
    Number(value.deleted_count) < 0 || Number(value.deleted_count) > ids.length) invalid();
  return Number(value.deleted_count);
}
```

- [ ] **Step 4: 运行确认通过**：`pnpm exec vitest run tests/unit/admin-users.test.ts`，Expected: PASS。

- [ ] **Step 5: 合成 API**（`ui-api.mjs`：在 `if (req.method === 'POST' && url.pathname === '/api/v1/admin/users') { … }` 块之后、`const account = accounts.find(` 之前插入；必须在该行之前，否则 `split('/')[5]` 会把 `batch-delete` 当作 ID）

```js
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/users/batch-delete') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) return send(null,422,'请选择 1–100 个不同的用户');
      const targets = accounts.filter(item => ids.includes(item.id));
      if (targets.some(item => item.is_admin)) return send(null,409,'不能删除站主账号');
      for (const target of targets) {
        accounts.splice(accounts.indexOf(target), 1);
        for (const [key,id] of sessions) if (id === target.id) sessions.delete(key);
      }
      return send({deleted:true,deleted_count:targets.length});
    }
```

- [ ] **Step 6: 全量单测与类型检查**：`pnpm test && pnpm check`，Expected: 全部通过，0 错误 0 警告。

- [ ] **Step 7: 核对改动**：`git diff --stat`。不提交。

---

### Task 4: 用户管理页多选、操作栏与确认对话框

**Files:**
- Modify: `frontend/src/routes/admin/users/+page.svelte`
- Test: `frontend/tests/ui/admin-users.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `deleteAdminUsers` 与合成 API。
- Produces: 页面元素（UI 测试依赖的可访问名称）：表头复选框 `全选本页`（`id="select-page"`）；行复选框 `选择 {昵称} @{用户名}`；操作栏 region `批量管理用户`，含「已选 N 个」「清除选择」「删除所选」；对话框标题 `永久删除 N 个用户？`，输入框标签 `输入“删除”以确认`，确认按钮 `永久删除`；成功提示 `已删除 N 个用户。`；「新增用户」按钮 `id="create-user"`。

- [ ] **Step 1: 写失败的 UI 测试**（追加到 `admin-users.spec.ts`；复用文件内 `create()` 与 `loginRunner`）

```ts
test('owner selects accounts on the current page and permanently deletes them', async ({ page }) => {
  await loginRunner(page); await page.goto('/admin/users');
  await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /· 站主/ }) }).getByRole('checkbox')).toHaveCount(0);
  const first = await create(page, 'ui_bulk_one');
  const second = await create(page, 'ui_bulk_two');
  await page.getByLabel('邮箱或用户名', { exact: true }).fill('ui_bulk_');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByRole('row')).toHaveCount(3);

  const header = page.getByRole('checkbox', { name: '全选本页', exact: true });
  const toolbar = page.getByRole('region', { name: '批量管理用户' });
  await expect(toolbar).toHaveCount(0);
  await first.getByRole('checkbox').check();
  await expect(toolbar).toContainText('已选 1 个');
  expect(await header.evaluate(element => (element as HTMLInputElement).indeterminate)).toBe(true);
  await header.check();
  await expect(second.getByRole('checkbox')).toBeChecked();
  await expect(toolbar).toContainText('已选 2 个');

  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  await header.check();

  const remove = toolbar.getByRole('button', { name: '删除所选', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: '永久删除 2 个用户？', exact: true });
  await expect(dialog).toContainText('@ui_bulk_one');
  await expect(dialog).toContainText('@ui_bulk_two');
  const confirm = dialog.getByRole('button', { name: '永久删除', exact: true });
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(remove).toBeFocused();

  await remove.click();
  await dialog.getByLabel('输入“删除”以确认').fill('删');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('输入“删除”以确认').fill('删除');
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('已删除 2 个用户。', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合条件的用户。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增用户', exact: true })).toBeFocused();
});
```

- [ ] **Step 2: 运行确认失败**

Run（frontend/）：`pnpm exec playwright test --config playwright.ui.config.ts tests/ui/admin-users.spec.ts -g "permanently deletes"`
Expected: FAIL，找不到 `全选本页` 复选框。

- [ ] **Step 3: 脚本部分**（`+page.svelte` `<script>`）

1. import 补 `deleteAdminUsers`：

```ts
  import { AdminUserError, createAdminUser, deleteAdminUsers, readAdminUsers, resetAdminUserPassword, updateAdminUser, type AdminUser, type AdminUserList } from '#lib/api/admin-users.ts';
```

2. 在 `let editor: HTMLDialogElement, confirmation: HTMLDialogElement;` 改为并追加状态：

```ts
  let editor: HTMLDialogElement, confirmation: HTMLDialogElement, deletion: HTMLDialogElement;
  let chosen = $state<string[]>([]), removing = $state<AdminUser[]>([]), removal = $state('');
  const selectable = $derived(users?.items.filter(user => !user.is_admin) ?? []);
  const allChosen = $derived(selectable.length > 0 && selectable.every(user => chosen.includes(user.id)));
```

3. `load()` 中 `loading = true; error = '';` 改为 `loading = true; error = ''; chosen = [];`（翻页、筛选、重新读取都会清空选择）。

4. `restoreFocus()` 改为同时清理删除状态：

```ts
  function restoreFocus() { password = ''; repeatedPassword = ''; dialogError = ''; selected = null; removal = ''; removing = []; if (returnFocus?.isConnected) returnFocus.focus(); }
```

5. 在 `copy()` 之前追加：

```ts
  function choose(id: string, checked: boolean) { chosen = checked ? [...new Set([...chosen, id])] : chosen.filter(value => value !== id); }
  async function confirmDeletion() {
    if (busy || !chosen.length) return;
    rememberFocus(); removing = selectable.filter(user => chosen.includes(user.id)); removal = ''; dialogError = '';
    await tick(); if (!disposed) deletion.showModal();
  }
  async function removeChosen(event: SubmitEvent) {
    event.preventDefault(); if (busy || removal !== '删除' || !removing.length) return;
    busy = true; dialogError = ''; notice = '';
    let done = false;
    try {
      const count = await deleteAdminUsers(removing.map(user => user.id));
      if (disposed) return;
      notice = `已删除 ${count} 个用户。`;
      returnFocus = null; deletion.close();
      await load(users?.offset ?? 0); done = true;
    } catch (cause) { if (!disposed) dialogError = failed(cause); }
    finally { if (!disposed) busy = false; }
    // Focus only after busy clears; the trigger button disappeared with the selection.
    if (done && !disposed) { await tick(); (document.getElementById('select-page') ?? document.getElementById('create-user'))?.focus(); }
  }
```

- [ ] **Step 4: 模板部分**

1. 「新增用户」按钮加 `id="create-user"`：

```svelte
  {#snippet actions()}{#if administrator}<button id="create-user" type="button" class="button-secondary" disabled={busy} onclick={() => edit(null)}>新增用户</button>{/if}{/snippet}
```

2. 在 `<section class="aux-panel" aria-label="用户列表" …>` 内、`<div class="table-scroll" …>` 之前插入操作栏：

```svelte
        {#if chosen.length}<div class="selection-toolbar" role="region" aria-label="批量管理用户">
          <span class="selected-count">已选 {chosen.length} 个</span>
          <button type="button" class="button-secondary" disabled={busy} onclick={() => chosen = []}>清除选择</button>
          <button type="button" class="delete-button" disabled={busy || loading} onclick={confirmDeletion}>删除所选</button>
        </div>{/if}
```

3. 表头 `<thead><tr>` 首列前插入：

```svelte
<th scope="col" class="select-cell">{#if selectable.length}<input id="select-page" type="checkbox" aria-label="全选本页" checked={allChosen} indeterminate={chosen.length > 0 && !allChosen} disabled={busy || loading} onchange={event => chosen = event.currentTarget.checked ? selectable.map(user => user.id) : []} />{:else}<span class="sr-only">选择</span>{/if}</th>
```

4. 每行 `<tr>` 内 `<th scope="row">` 之前插入：

```svelte
              <td class="select-cell">{#if !user.is_admin}<input type="checkbox" aria-label={`选择 ${user.display_name} @${user.username}`} checked={chosen.includes(user.id)} disabled={busy || loading} onchange={event => choose(user.id, event.currentTarget.checked)} />{/if}</td>
```

5. 在 `confirmation` 对话框之后、`<style>` 之前追加删除对话框：

```svelte
<dialog bind:this={deletion} aria-labelledby="user-delete-title" aria-describedby="user-delete-hint" onclose={restoreFocus} oncancel={event => { if (busy) event.preventDefault(); }}>
  <form onsubmit={removeChosen} class="user-form" aria-busy={busy}>
    <h2 id="user-delete-title" class="text-xl font-semibold">永久删除 {removing.length} 个用户？</h2>
    <p id="user-delete-hint">将永久删除这些账号及其全部运动记录、轨迹、原始文件、AI 报告和分享链接，无法恢复。</p>
    <ul class="delete-list">{#each removing as user (user.id)}<li>{user.display_name}（@{user.username}）</li>{/each}</ul>
    <label>输入“删除”以确认<input autocomplete="off" bind:value={removal} disabled={busy} /></label>
    {#if dialogError}<FeedbackState kind="error" title={dialogError} />{/if}
    <div class="flex flex-wrap gap-3"><button type="submit" class="delete-confirm" disabled={busy || removal !== '删除'}>{busy ? '删除中…' : '永久删除'}</button><button type="button" class="button-secondary" disabled={busy} onclick={() => deletion.close()}>取消</button></div>
  </form>
</dialog>
```

6. `<style>` 末尾追加（仅语义令牌）：

```css
  .select-cell { width: 3rem; }
  .select-cell input { width: 1.25rem; height: 1.25rem; }
  .selection-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .selected-count { flex: 1; color: var(--muted-foreground); white-space: nowrap; font-size: .875rem; }
  .delete-button, .delete-confirm { padding: .625rem .875rem; border-radius: var(--radius-control); font-size: .875rem; font-weight: 600; color: var(--error); border: 1px solid var(--error-border); }
  .delete-confirm { background: var(--error-soft); }
  .delete-confirm:disabled, .delete-button:disabled { opacity: .5; }
  .delete-list { max-height: 12rem; overflow-y: auto; padding-left: var(--space-5); list-style: disc; }
```

- [ ] **Step 5: 运行新 UI 用例**：同 Step 2 命令，Expected: PASS。

- [ ] **Step 6: 回归**

Run（frontend/）：
```bash
pnpm check
pnpm exec playwright test --config playwright.ui.config.ts tests/ui/admin-users.spec.ts tests/ui/theme.spec.ts
```
Expected: `pnpm check` 0 错误 0 警告；`admin-users.spec.ts` 全部 PASS。`ui-shell.spec.ts` 已知有 3 个改动前即失败的用例（退出跳转、目标草稿、1280×720 侧栏高度），如运行需单独列出，不归因于本次改动。

- [ ] **Step 7: 手动核对明暗主题与窄屏**：`pnpm exec playwright test --config playwright.ui.config.ts tests/ui/admin-users.spec.ts -g "permanently deletes" --headed` 观察，或在该用例中临时截图到 `test.info().outputPath()`（不入库）；确认深色模式下危险按钮可读、390px 宽时操作栏换行且无页面横向滚动。

- [ ] **Step 8: 核对改动**：`git diff --stat`。不提交。

---

### Task 5: 特性文档与验证记录

**Files:**
- Create: `docs/60-admin-users-batch-delete.md`（编号先 `ls docs/` 确认为当前最大编号 +1；写本计划时最大为 59）
- Modify: `docs/superpowers/specs/2026-10-18-admin-users-batch-delete-design.md`（「验证记录」节）

- [ ] **Step 1: 确认编号**：`ls docs/ | grep -E '^[0-9]+' | sort -n | tail -1`，取其 +1。

- [ ] **Step 2: 写特性文档**，结构如下（内容用中文，证据填本次真实命令输出）：

```markdown
# 用户批量删除

## 使用方式
站主进入「用户管理」→ 勾选当前页普通账号（站主行不可选，表头可全选/半选）→「删除所选」→ 核对列表并输入「删除」→「永久删除」。翻页、筛选或刷新会清空选择。

## 接口与隐私
`POST /api/v1/admin/users/batch-delete`，请求 `{"ids": [...]}`（1–100 个不重复 UUID），响应 `{"deleted": true, "deleted_count": n}`。仅站主，需 CSRF/Origin。含站主整批 409 `OWNER_PROTECTED`；不存在的 ID 忽略。删除经数据库级联清除记录、轨迹、原始文件、AI 报告、目标、分享与会话；响应不回显账号资料。无迁移。

## 验证记录
（逐条列出实际运行的命令与通过/失败/跳过数量；列出未运行项与原因）
```

- [ ] **Step 3: 更新 spec 的「验证记录」**，指向该特性文档并列出同样的命令结果。

- [ ] **Step 4: 最终核对**：`git status --short` 与 `git diff --stat`，确认只含本计划涉及文件和此前已有的未提交改动（`AppNavigation.svelte`、`admin-users.spec.ts` 的导航改动、本 spec 与 plan）。不提交，向用户报告并询问是否授权提交。
