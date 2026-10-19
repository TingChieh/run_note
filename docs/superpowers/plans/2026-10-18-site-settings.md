# 站点设置与用户头像 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 站主可配置站点标题/副标题/页脚标语/描述/默认主题与 favicon、站内标志；每个用户可上传头像；全站渲染跟随设置。

**Architecture:** 后端新模块 `site_settings`（单行设置表 + 站点图片表）与 users 模块头像端点；所有上传图片经 Pillow 解码、方向校正、居中裁方、缩放并重编码为无元数据 PNG 存入 PostgreSQL。前端 hooks 每次页面请求读取 `/api/v1/site` 注入 layout 与 `app.html`（favicon、首屏默认主题），失败回退内置默认值；设置页拆为 `/settings`（账户+头像）与 `/settings/site`（站主）。

**Tech Stack:** FastAPI / Pydantic 2 / SQLAlchemy 2（同步）/ Alembic / Pillow / pytest；SvelteKit 3 + Svelte 5 runes / Vitest / Playwright（合成 API）。

**Spec:** `docs/superpowers/specs/2026-10-18-site-settings-design.md`

## Global Constraints

- 文字上限：`title` 40、`subtitle` 40、`footer_tagline` 80、`description` 200；去首尾空白；`title` 去空白后不得为空；其余可为空字符串。
- 默认值：`title="RunNote"`，`subtitle="跑步与足迹"`，`footer_tagline="记录每一步，看见你的进步。"`，`description="汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。"`，`default_theme="system"`。
- `default_theme ∈ {system, light, dark}`；站点图片 `kind ∈ {favicon, logo}`。
- 图片：只接受 Pillow 识别为 `PNG|JPEG|WEBP`；文件 ≤ 5 MiB（413 `IMAGE_TOO_LARGE`）；请求体 ≤ 6 MiB（中间件 413 `IMAGE_TOO_LARGE`）；`Image.MAX_IMAGE_PIXELS = 40_000_000`，超限 422 `IMAGE_TOO_LARGE`；非支持格式 415 `IMAGE_UNSUPPORTED`；解码失败或最短边 < 32 → 422 `IMAGE_INVALID`；目标边长 avatar 512 / logo 256 / favicon 64（不放大）；输出 PNG 无任何元数据。
- 图片 URL：`/api/v1/site/images/{kind}?v=<sha256前16位>`、`/api/v1/me/avatar?v=…`、`/api/v1/showcase/avatar?v=…`、`/api/v1/showcase/users/{username}/avatar?v=…`。
- 图片 GET 响应头：`Content-Type: image/png`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'`。
- 权限：站点写用 `require_admin_write`；头像写用 `require_write`（只写本人，不接受客户端 user id）；展示头像复用 `get_site_owner`（不可公开统一 404）。
- 后端分层：router 只做 HTTP 与 `db.commit()`；service 同步普通函数、`db.flush()`；schema 继承 `StrictInput`；PATCH 用 `exclude_unset=True` 且至少一个字段；错误 `ApiError(status, "CODE", "中文提示")`；`envelope` 从 `app.modules.auth.router` 导入；模型注册到 `app/models/__init__.py`，router 注册到 `app/main.py`；上传入口 `async def` 必须 `run_in_threadpool` 卸载 Pillow 处理与 DB 写入。
- 站点设置与头像写入**不调用** `lock_owner`（不影响 `activity_data_version`）。
- 前端：`#lib/...` 带 `.ts`；runes；不使用 store/`createEventDispatcher`/`$app/stores`；`disposed` 与请求令牌；401 跳转登录；`lib/api/*` 运行时逐字段校验；写操作先取 CSRF；颜色只用语义令牌；SSR 代理（`lib/server/backend.ts`、`routes/api/[...path]/+server.ts`、`proxy-policy.ts`）**不改**。
- 测试库：`runnote_tcx_v2_20261015_test`（只注入进程环境，不改 `.env`，不打印 DSN）；**不在开发库执行迁移**；跳过不等于通过。
- **不执行 `git commit`/`add`/`stash`**（每个任务结束用 `git diff --stat` 核对）。不读取 `.env`、`.env.auth-rate.key`。

### 命令约定（backend/ 下）

「运行集成测试 <paths>」：

```bash
.venv/bin/python - <paths> <<'PY'
import os, subprocess, sys
from sqlalchemy.engine import make_url
from app.core.config import Settings
url = make_url(Settings().database_url).set(database="runnote_tcx_v2_20261015_test")
env = {**os.environ,
       "TEST_DATABASE_URL": url.render_as_string(hide_password=False),
       "TEST_DATABASE_ALLOWED_TARGETS": f"{url.host}:{url.port or 5432}/{url.database}"}
raise SystemExit(subprocess.run([".venv/bin/pytest", "-q", "--tb=short", *sys.argv[1:]], env=env).returncode)
PY
```

「升级测试库」（仅该 `_test` 库）：

```bash
.venv/bin/python - <<'PY'
import os, subprocess
from sqlalchemy.engine import make_url
from app.core.config import Settings
url = make_url(Settings().database_url).set(database="runnote_tcx_v2_20261015_test")
assert url.database.endswith("_test")
env = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False), "APP_ENV": "test"}
for args in (["upgrade", "head"], ["current"]):
    print(subprocess.run([".venv/bin/alembic", *args], env=env, capture_output=True, text=True, check=True).stdout.strip())
PY
```

---

### Task 1: Pillow 依赖与图片规范化

**Files:**
- Modify: `backend/pyproject.toml`、`backend/requirements.lock`
- Create: `backend/app/modules/site_settings/__init__.py`（空）、`backend/app/modules/site_settings/images.py`
- Test: `backend/tests/unit/test_site_images.py`

**Interfaces:**
- Produces: `normalize_image(raw: bytes, purpose: Literal["avatar","logo","favicon"]) -> ProcessedImage`；`ProcessedImage(png: bytes, width: int, height: int, sha256: str)`（frozen dataclass）；常量 `MAX_IMAGE_BYTES = 5 * 1024 * 1024`、`SIZES = {"avatar": 512, "logo": 256, "favicon": 64}`；`image_version(sha256: str) -> str`（返回前 16 位）。

- [ ] **Step 1: 加依赖**：`pyproject.toml` 的 `dependencies` 末尾加 `"Pillow==<版本>"`。版本取当前最新稳定版：先运行 `UV_CACHE_DIR=/private/tmp/run-note-uv-cache uv pip compile pyproject.toml --extra dev --python .venv/bin/python --generate-hashes --output-file /private/tmp/run-note-lock-probe.txt`（`pyproject` 暂写 `"Pillow"` 不带版本），从输出读出 Pillow 版本后改为精确 `==`，再按 `requirements.lock` 第 2 行的原命令重新生成 `requirements.lock`（同样带 `UV_CACHE_DIR`）。核对 diff：除 Pillow 外其他包版本**不应变化**；若有变化，停止并报告。随后安装：`UV_CACHE_DIR=/private/tmp/run-note-uv-cache uv pip sync requirements.lock --python .venv/bin/python`，验证 `.venv/bin/python -c "import PIL; print(PIL.__version__)"`。

- [ ] **Step 2: 写失败的测试** `backend/tests/unit/test_site_images.py`：

```python
from io import BytesIO

import pytest
from PIL import ExifTags, Image

from app.core.errors import ApiError
from app.modules.site_settings import images
from app.modules.site_settings.images import image_version, normalize_image


def encoded(size=(100, 60), fmt="PNG", color=(200, 30, 30), **kwargs):
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def test_jpeg_metadata_is_removed_and_output_is_clean_png():
    exif = Image.Exif()
    exif[ExifTags.Base.ImageDescription] = "synthetic-secret-marker"
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "N"
    gps[ExifTags.GPS.GPSLatitude] = (31.0, 14.0, 0.0)
    raw = encoded((120, 120), "JPEG", exif=exif.tobytes())
    assert b"synthetic-secret-marker" in raw
    result = normalize_image(raw, "avatar")
    assert result.png.startswith(b"\x89PNG\r\n\x1a\n")
    assert b"synthetic-secret-marker" not in result.png
    with Image.open(BytesIO(result.png)) as image:
        assert image.format == "PNG"
        assert not image.getexif()
        assert not ({"exif", "icc_profile", "dpi"} & set(image.info))
        assert not getattr(image, "text", {})


@pytest.mark.parametrize(
    "purpose,size,expected",
    [("avatar", (100, 60), 60), ("logo", (600, 400), 256), ("favicon", (300, 900), 64)],
)
def test_center_crop_square_without_upscaling(purpose, size, expected):
    result = normalize_image(encoded(size), purpose)
    assert (result.width, result.height) == (expected, expected)
    with Image.open(BytesIO(result.png)) as image:
        assert image.size == (expected, expected)


def test_exif_orientation_is_applied_before_crop():
    # Orientation 6 rotates a 40x80 portrait source into an 80x40 landscape image.
    source = Image.new("RGB", (40, 80), (0, 0, 255))
    source.paste((255, 0, 0), (0, 0, 40, 40))
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6
    buffer = BytesIO()
    source.save(buffer, format="JPEG", exif=exif.tobytes(), quality=95)
    result = normalize_image(buffer.getvalue(), "avatar")
    assert (result.width, result.height) == (40, 40)


def test_version_and_hash_are_stable():
    raw = encoded()
    first, second = normalize_image(raw, "logo"), normalize_image(raw, "logo")
    assert first.sha256 == second.sha256 and len(first.sha256) == 64
    assert image_version(first.sha256) == first.sha256[:16]


@pytest.mark.parametrize(
    "raw,status,code",
    [
        (encoded(fmt="GIF"), 415, "IMAGE_UNSUPPORTED"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 415, "IMAGE_UNSUPPORTED"),
        (encoded()[:40], 422, "IMAGE_INVALID"),
        (b"", 422, "IMAGE_INVALID"),
        (encoded((20, 200)), 422, "IMAGE_INVALID"),
        (b"\0" * (5 * 1024 * 1024 + 1), 413, "IMAGE_TOO_LARGE"),
    ],
)
def test_rejections(raw, status, code):
    with pytest.raises(ApiError) as error:
        normalize_image(raw, "avatar")
    assert (error.value.status_code, error.value.code) == (status, code)


def test_decompression_bomb_is_rejected(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    with pytest.raises(ApiError) as error:
        normalize_image(encoded((40, 40)), "avatar")  # 1600 px: above the limit
    assert error.value.code == "IMAGE_TOO_LARGE"
    assert images.MAX_IMAGE_BYTES == 5 * 1024 * 1024
```

注：截断 PNG（前 40 字节）若被 Pillow 识别为 PNG 但 `load()` 失败应得 `IMAGE_INVALID`；若实现中发现 Pillow 对该样本报 `UnidentifiedImageError`，把该样本改为 `encoded()[:len(encoded())//2]`（同样应为 422），并在报告中说明。

- [ ] **Step 3: 运行确认失败**：`.venv/bin/pytest tests/unit/test_site_images.py -q` → `ModuleNotFoundError: app.modules.site_settings.images`。

- [ ] **Step 4: 实现** `backend/app/modules/site_settings/images.py`：

```python
"""Decode, orient, square-crop and re-encode uploads as metadata-free PNG."""

import warnings
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ApiError

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_SIDE = 32
SIZES = {"avatar": 512, "logo": 256, "favicon": 64}
FORMATS = {"PNG", "JPEG", "WEBP"}
Purpose = Literal["avatar", "logo", "favicon"]


@dataclass(frozen=True)
class ProcessedImage:
    png: bytes
    width: int
    height: int
    sha256: str


def image_version(digest: str) -> str:
    return digest[:16]


def too_large():
    return ApiError(413, "IMAGE_TOO_LARGE", "图片不能超过 5 MiB")


def decode(raw: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in FORMATS:
                    raise ApiError(415, "IMAGE_UNSUPPORTED", "仅支持 PNG、JPEG 或 WebP 图片")
                source.load()
                return ImageOps.exif_transpose(source)
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ApiError(422, "IMAGE_TOO_LARGE", "图片像素过多，请缩小后再上传") from None
    except UnidentifiedImageError:
        raise ApiError(415, "IMAGE_UNSUPPORTED", "仅支持 PNG、JPEG 或 WebP 图片") from None
    except (OSError, ValueError, SyntaxError):
        raise ApiError(422, "IMAGE_INVALID", "图片无法读取，请换一张") from None


def normalize_image(raw: bytes, purpose: Purpose) -> ProcessedImage:
    if len(raw) > MAX_IMAGE_BYTES:
        raise too_large()
    if not raw:
        raise ApiError(422, "IMAGE_INVALID", "图片无法读取，请换一张")
    image = decode(raw).convert("RGBA")
    side = min(image.size)
    if side < MIN_SIDE:
        raise ApiError(422, "IMAGE_INVALID", "图片尺寸过小，最短边至少 32 像素")
    left, top = (image.width - side) // 2, (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side))
    target = min(side, SIZES[purpose])
    if target != side:
        image = image.resize((target, target), Image.Resampling.LANCZOS)
    image.info.clear()  # Never carry ICC, EXIF, text or DPI from the source.
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    png = buffer.getvalue()
    return ProcessedImage(png=png, width=target, height=target, sha256=sha256(png).hexdigest())
```

- [ ] **Step 5: 运行通过**：`.venv/bin/pytest tests/unit/test_site_images.py -q` 全部 PASS；再跑 `.venv/bin/pytest tests/unit -q`、`.venv/bin/ruff check app migrations tests`、`.venv/bin/ruff format --check app migrations tests`。

- [ ] **Step 6: 核对**：`git diff --stat`（应仅 pyproject、requirements.lock、新模块两个文件与测试）。不提交。

---

### Task 2: 迁移 0012 与模型

**Files:**
- Create: `backend/migrations/versions/0012_site_settings.py`、`backend/app/modules/site_settings/model.py`
- Modify: `backend/app/modules/users/model.py`（加 `avatar_version` 与 `UserAvatar`）、`backend/app/models/__init__.py`、`backend/tests/unit/test_schema.py`
- Test: `backend/tests/unit/test_site_settings.py`（新建，迁移部分）

**Interfaces:**
- Produces: ORM `SiteSettings`（`id, title, subtitle, footer_tagline, description, default_theme, updated_at`）、`SiteImage`（`kind, png_bytes, width, height, sha256, updated_at`）位于 `app.modules.site_settings.model`；`UserAvatar`（`user_id, png_bytes, sha256, updated_at`）与 `User.avatar_version: str | None` 位于 `app.modules.users.model`；迁移 revision `0012_site_settings`；常量 `DEFAULTS: dict[str, str]` 位于 `app.modules.site_settings.model`（Global Constraints 中的五个默认值）。

- [ ] **Step 1: 确认序号**：`ls backend/migrations/versions/` 最大为 `0011_admin_user_states.py`；若不同，按实际顺延并同步本任务所有引用。

- [ ] **Step 2: 写失败测试**：
  - `tests/unit/test_schema.py` 中两处 `"0011_admin_user_states"` 改为 `"0012_site_settings"`；`expected` 表集合加入 `"site_settings"`, `"site_images"`, `"user_avatars"`。
  - 新建 `tests/unit/test_site_settings.py`：

```python
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.modules.site_settings.model import DEFAULTS, SiteImage, SiteSettings
from app.modules.users.model import User, UserAvatar


def load_migration():
    path = Path(__file__).parents[2] / "migrations/versions/0012_site_settings.py"
    spec = importlib.util.spec_from_file_location("site_settings_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_models_match_constraints():
    assert SiteSettings.__table__.c.title.type.length == 40
    assert SiteSettings.__table__.c.description.type.length == 200
    assert {c.name for c in SiteImage.__table__.constraints if c.name} >= {
        "ck_site_images_kind_valid"
    }
    fk = next(iter(UserAvatar.__table__.c.user_id.foreign_keys))
    assert fk.ondelete == "CASCADE" and fk.column.table.name == "users"
    assert User.__table__.c.avatar_version.nullable
    assert DEFAULTS["title"] == "RunNote" and DEFAULTS["default_theme"] == "system"


def test_migration_chain_and_defensive_downgrade(monkeypatch):
    migration = load_migration()
    assert migration.revision == "0012_site_settings"
    assert migration.down_revision == "0011_admin_user_states"
    op = Mock()
    monkeypatch.setattr(migration, "op", op)
    op.get_bind.return_value.execute.return_value.scalar.return_value = True
    with pytest.raises(RuntimeError):
        migration.downgrade()
    op.drop_table.assert_not_called()
    op.drop_column.assert_not_called()
```

- [ ] **Step 3: 运行确认失败**：`.venv/bin/pytest tests/unit/test_schema.py tests/unit/test_site_settings.py -q` → 导入失败。

- [ ] **Step 4: 模型** `backend/app/modules/site_settings/model.py`：

```python
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, LargeBinary, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DEFAULTS = {
    "title": "RunNote",
    "subtitle": "跑步与足迹",
    "footer_tagline": "记录每一步，看见你的进步。",
    "description": "汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。",
    "default_theme": "system",
}


class SiteSettings(Base):
    __tablename__ = "site_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint("char_length(btrim(title)) > 0", name="title_present"),
        CheckConstraint("default_theme IN ('system','light','dark')", name="default_theme_valid"),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    title: Mapped[str] = mapped_column(String(40), server_default=DEFAULTS["title"])
    subtitle: Mapped[str] = mapped_column(String(40), server_default=DEFAULTS["subtitle"])
    footer_tagline: Mapped[str] = mapped_column(
        String(80), server_default=DEFAULTS["footer_tagline"]
    )
    description: Mapped[str] = mapped_column(String(200), server_default=DEFAULTS["description"])
    default_theme: Mapped[str] = mapped_column(
        String(10), server_default=DEFAULTS["default_theme"]
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SiteImage(Base):
    __tablename__ = "site_images"
    __table_args__ = (
        CheckConstraint("kind IN ('favicon','logo')", name="kind_valid"),
        CheckConstraint("octet_length(png_bytes) > 0", name="png_present"),
    )

    kind: Mapped[str] = mapped_column(String(10), primary_key=True)
    png_bytes: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

`backend/app/modules/users/model.py`：import 补 `ForeignKey, LargeBinary`（及 `UUID` 已有）；`User` 增加 `avatar_version: Mapped[str | None] = mapped_column(String(16), nullable=True)`；文件末尾追加：

```python
class UserAvatar(Base):
    __tablename__ = "user_avatars"
    __table_args__ = (CheckConstraint("octet_length(png_bytes) > 0", name="png_present"),)

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    png_bytes: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    sha256: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

`app/models/__init__.py`：导入 `SiteImage, SiteSettings`（`app.modules.site_settings.model`）与 `UserAvatar`（`app.modules.users.model`），加入 `__all__`。

- [ ] **Step 5: 迁移** `backend/migrations/versions/0012_site_settings.py`：

```python
"""Single-row site settings, owner-managed site images and per-user avatars."""

import sqlalchemy as sa
from alembic import op

revision = "0012_site_settings"
down_revision = "0011_admin_user_states"
branch_labels = None
depends_on = None

DEFAULTS = {
    "title": "RunNote",
    "subtitle": "跑步与足迹",
    "footer_tagline": "记录每一步，看见你的进步。",
    "description": "汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。",
    "default_theme": "system",
}


def timestamp():
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade():
    op.create_table(
        "site_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("title", sa.String(40), nullable=False, server_default=DEFAULTS["title"]),
        sa.Column("subtitle", sa.String(40), nullable=False, server_default=DEFAULTS["subtitle"]),
        sa.Column(
            "footer_tagline",
            sa.String(80),
            nullable=False,
            server_default=DEFAULTS["footer_tagline"],
        ),
        sa.Column(
            "description", sa.String(200), nullable=False, server_default=DEFAULTS["description"]
        ),
        sa.Column(
            "default_theme",
            sa.String(10),
            nullable=False,
            server_default=DEFAULTS["default_theme"],
        ),
        timestamp(),
        sa.CheckConstraint("id = 1", name=op.f("ck_site_settings_singleton")),
        sa.CheckConstraint(
            "char_length(btrim(title)) > 0", name=op.f("ck_site_settings_title_present")
        ),
        sa.CheckConstraint(
            "default_theme IN ('system','light','dark')",
            name=op.f("ck_site_settings_default_theme_valid"),
        ),
    )
    op.execute("INSERT INTO site_settings (id) VALUES (1)")
    op.create_table(
        "site_images",
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("png_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        timestamp(),
        sa.CheckConstraint("kind IN ('favicon','logo')", name=op.f("ck_site_images_kind_valid")),
        sa.CheckConstraint(
            "octet_length(png_bytes) > 0", name=op.f("ck_site_images_png_present")
        ),
    )
    op.create_table(
        "user_avatars",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("png_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        timestamp(),
        sa.CheckConstraint(
            "octet_length(png_bytes) > 0", name=op.f("ck_user_avatars_png_present")
        ),
    )
    op.add_column("users", sa.Column("avatar_version", sa.String(16), nullable=True))


def downgrade():
    customized = " OR ".join(f"{column} <> :{column}" for column in DEFAULTS)
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM site_images) "
                "OR EXISTS (SELECT 1 FROM user_avatars) "
                f"OR EXISTS (SELECT 1 FROM site_settings WHERE {customized})"
            ),
            DEFAULTS,
        )
        .scalar()
    ):
        raise RuntimeError("Cannot discard customized site settings, site images or avatars")
    op.drop_column("users", "avatar_version")
    op.drop_table("user_avatars")
    op.drop_table("site_images")
    op.drop_table("site_settings")
```

FK 约束名需与模型命名约定一致（`fk_user_avatars_user_id_users`）：若 Alembic 生成名不同，给 `sa.ForeignKey` 加 `name=op.f("fk_user_avatars_user_id_users")`（参照 `0009_mifitness_imports.py` 写法）。

- [ ] **Step 6: 运行单测**：`.venv/bin/pytest tests/unit -q`，Expected PASS。

- [ ] **Step 7: 升级测试库并核对**：执行「升级测试库」，`current` 应输出 `0012_site_settings (head)`。然后「运行集成测试 tests/integration/test_migrations.py」，Expected PASS（该文件会自行 upgrade head 并核对 ready）。若某集成用例因表集合/列断言失败，按新 schema 调整断言并在报告说明。

- [ ] **Step 8: Ruff + `git diff --stat`**。不提交。

---

### Task 3: 站点设置接口、站点图片与请求体限制

**Files:**
- Create: `backend/app/modules/site_settings/schema.py`、`service.py`、`router.py`、`body_limit.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/unit/test_site_settings.py`（追加）、`backend/tests/integration/test_site_settings.py`（新建）

**Interfaces:**
- Consumes: Task 1 `normalize_image`、`image_version`、`MAX_IMAGE_BYTES`；Task 2 模型与 `DEFAULTS`。
- Produces:
  - `SiteView`（`title, subtitle, footer_tagline, description: str; default_theme: Literal["system","light","dark"]; favicon_url, logo_url: str | None`）、`SitePatch`。
  - service：`read_site(db) -> SiteView`、`update_site(db, payload) -> SiteView`、`put_image(db, kind, raw) -> SiteView`、`remove_image(db, kind) -> SiteView`、`image_bytes(db, kind) -> bytes`（无图 404）。
  - `png_response(data: bytes) -> Response`（位于 `site_settings/router.py`，Task 4 复用：`from app.modules.site_settings.router import png_response`）。
  - `read_upload(request) -> bytes`（位于 `site_settings/router.py`，async；解析 multipart 只允许单个 `file` 字段，读取上限 `MAX_IMAGE_BYTES`；Task 4 复用）。
  - 中间件 `ImageBodyLimit`（`site_settings/body_limit.py`），覆盖 `PUT /api/v1/site/images/favicon|logo` 与 `PUT /api/v1/me/avatar`，上限 6 MiB。

- [ ] **Step 1: 写失败的 schema 单测**（追加到 `tests/unit/test_site_settings.py`）：

```python
from pydantic import ValidationError

from app.modules.site_settings.schema import SitePatch


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": "   "},
        {"title": "x" * 41},
        {"subtitle": "x" * 41},
        {"footer_tagline": "x" * 81},
        {"description": "x" * 201},
        {"default_theme": "blue"},
        {"title": "ok", "logo_url": "/x"},
    ],
)
def test_site_patch_rejects(payload):
    with pytest.raises(ValidationError):
        SitePatch.model_validate(payload)


def test_site_patch_strips_and_allows_empty_optional_text():
    patch = SitePatch.model_validate({"title": "  晨跑站  ", "subtitle": "  "})
    assert patch.model_dump(exclude_unset=True) == {"title": "晨跑站", "subtitle": ""}
```

- [ ] **Step 2: 运行确认失败**：`.venv/bin/pytest tests/unit/test_site_settings.py -q` → ImportError。

- [ ] **Step 3: schema.py**：

```python
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.users.schema import StrictInput

Theme = Literal["system", "light", "dark"]


class SiteView(BaseModel):
    title: str
    subtitle: str
    footer_tagline: str
    description: str
    default_theme: Theme
    favicon_url: str | None
    logo_url: str | None


class SitePatch(StrictInput):
    title: str = Field(default=None, max_length=40)
    subtitle: str = Field(default=None, max_length=40)
    footer_tagline: str = Field(default=None, max_length=80)
    description: str = Field(default=None, max_length=200)
    default_theme: Theme = Field(default=None)

    @field_validator("title", "subtitle", "footer_tagline", "description", mode="before")
    @classmethod
    def strip(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("title")
    @classmethod
    def title_present(cls, value):
        if not value:
            raise ValueError("Site title required")
        return value

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        return self
```

（`max_length` 在 strip 之后校验：before 验证器先执行。）

- [ ] **Step 4: service.py**：

```python
from sqlalchemy import select

from app.core.errors import ApiError
from app.modules.site_settings.images import image_version, normalize_image
from app.modules.site_settings.model import SiteImage, SiteSettings
from app.modules.site_settings.schema import SiteView

KINDS = ("favicon", "logo")


def settings_row(db, lock=False):
    query = select(SiteSettings).where(SiteSettings.id == 1)
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise ApiError(503, "SITE_SETTINGS_UNAVAILABLE", "站点设置尚未初始化，请联系站点管理员")
    return row


def site_view(db, row):
    versions = dict(db.execute(select(SiteImage.kind, SiteImage.sha256)).all())
    url = {
        kind: f"/api/v1/site/images/{kind}?v={image_version(versions[kind])}"
        if kind in versions
        else None
        for kind in KINDS
    }
    return SiteView(
        title=row.title,
        subtitle=row.subtitle,
        footer_tagline=row.footer_tagline,
        description=row.description,
        default_theme=row.default_theme,
        favicon_url=url["favicon"],
        logo_url=url["logo"],
    )


def read_site(db):
    return site_view(db, settings_row(db))


def update_site(db, payload):
    row = settings_row(db, lock=True)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.flush()
    return site_view(db, row)


def checked_kind(kind):
    if kind not in KINDS:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "图片不存在")
    return kind


def put_image(db, kind, raw):
    processed = normalize_image(raw, checked_kind(kind))
    row = settings_row(db, lock=True)  # Serialize concurrent site writes.
    image = db.get(SiteImage, kind)
    if image is None:
        image = SiteImage(kind=kind)
        db.add(image)
    image.png_bytes, image.sha256 = processed.png, processed.sha256
    image.width, image.height = processed.width, processed.height
    db.flush()
    return site_view(db, row)


def remove_image(db, kind):
    row = settings_row(db, lock=True)
    image = db.get(SiteImage, checked_kind(kind))
    if image is not None:
        db.delete(image)
        db.flush()
    return site_view(db, row)


def image_bytes(db, kind):
    data = db.scalar(select(SiteImage.png_bytes).where(SiteImage.kind == checked_kind(kind)))
    if data is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "图片不存在")
    return data
```

- [ ] **Step 5: router.py**：

```python
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from app.api.dependencies import get_session, require_admin_write
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.site_settings import service
from app.modules.site_settings.images import MAX_IMAGE_BYTES
from app.modules.site_settings.schema import SitePatch, SiteView

router = APIRouter(prefix="/api/v1/site", tags=["site"])
DB = Annotated[Session, Depends(get_session)]
Write = Annotated[tuple, Depends(require_admin_write)]


def png_response(data: bytes) -> Response:
    return Response(
        content=data,
        media_type="image/png",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


async def read_upload(request: Request) -> bytes:
    try:
        async with request.form(max_files=1, max_fields=0, max_part_size=4096) as form:
            values = form.multi_items()
            file = form.get("file")
            if len(values) != 1 or not isinstance(file, UploadFile):
                raise ApiError(422, "VALIDATION_ERROR", "请选择单个图片文件")
            raw = bytearray()
            while chunk := await file.read(1024 * 1024):
                raw.extend(chunk)
                if len(raw) > MAX_IMAGE_BYTES:
                    raise ApiError(413, "IMAGE_TOO_LARGE", "图片不能超过 5 MiB")
            return bytes(raw)
    except HTTPException:
        raise ApiError(422, "VALIDATION_ERROR", "表单超出限制，请只上传一个图片文件") from None


@router.get("", response_model=ApiResponse[SiteView])
def read(request: Request, db: DB):
    return envelope(request, service.read_site(db))


@router.patch("", response_model=ApiResponse[SiteView])
def update(payload: SitePatch, request: Request, db: DB, identity: Write):
    data = service.update_site(db, payload)
    db.commit()
    return envelope(request, data)


@router.put("/images/{kind}", response_model=ApiResponse[SiteView])
async def upload(kind: str, request: Request, db: DB, identity: Write):
    db.commit()  # Release the identity lock before reading and decoding the upload.
    raw = await read_upload(request)
    data = await run_in_threadpool(service.put_image, db, kind, raw)
    await run_in_threadpool(db.commit)
    return envelope(request, data)


@router.delete("/images/{kind}", response_model=ApiResponse[SiteView])
def remove(kind: str, request: Request, db: DB, identity: Write):
    data = service.remove_image(db, kind)
    db.commit()
    return envelope(request, data)


@router.get("/images/{kind}")
def image(kind: str, db: DB):
    return png_response(service.image_bytes(db, kind))
```

注意：`upload` 中 `kind` 非法时 `normalize_image` 之前 `checked_kind` 会 404，但 `read_upload` 已先读完请求体——可接受。核对 `request.form(max_fields=0)` 在当前 Starlette 版本下允许仅含文件字段；若 `max_fields=0` 被视为禁止，改为 `max_fields=1` 并依旧用 `len(values) != 1` 拒绝多字段，报告说明。

- [ ] **Step 6: body_limit.py**（参照 `app/modules/gpx/body_limit.py`）：

```python
"""Reject oversized image upload bodies before multipart parsing allocates them."""

from uuid import uuid4

from starlette.requests import Request

from app.core.errors import ApiError, error_response

MAX_IMAGE_BODY = 6 * 1024 * 1024
PATHS = {"/api/v1/site/images/favicon", "/api/v1/site/images/logo", "/api/v1/me/avatar"}


class ImageBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "PUT" or scope.get("path") not in PATHS:
            return await self.app(scope, receive, send)
        scope.setdefault("state", {}).setdefault("request_id", uuid4().hex)
        length = dict(scope.get("headers", [])).get(b"content-length")
        try:
            excessive = length is not None and int(length) > MAX_IMAGE_BODY
        except ValueError:
            excessive = True
        if excessive:
            response = error_response(Request(scope), 413, "IMAGE_TOO_LARGE", "图片上传请求过大")
            return await response(scope, receive, send)
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > MAX_IMAGE_BODY:
                    raise ApiError(413, "IMAGE_TOO_LARGE", "图片上传请求过大")
            return message

        await self.app(scope, limited_receive, send)
```

- [ ] **Step 7: 注册**：`app/main.py` 导入 `from app.modules.site_settings.body_limit import ImageBodyLimit` 与 `from app.modules.site_settings.router import router as site_router`；`app.add_middleware(ImageBodyLimit)` 紧跟 `app.add_middleware(GpxBodyLimit)`；`app.include_router(site_router)` 加在 `include_router` 列表中（与其他模块并列）。

- [ ] **Step 8: 单测通过**：`.venv/bin/pytest tests/unit -q`。

- [ ] **Step 9: 写集成测试** `backend/tests/integration/test_site_settings.py`（复用 `tests.integration.test_showcase` 的 `site` fixture 与 `ORIGIN, PASSWORD`；`login`/`write_headers` 从 `tests.integration.test_admin_users` 导入）：

```python
"""Site settings and site images on an allowlisted _test DB."""

from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import delete

from app.main import create_app
from app.modules.site_settings.model import DEFAULTS, SiteImage, SiteSettings
from tests.integration.test_admin_users import login, write_headers
from tests.integration.test_showcase import ORIGIN, PASSWORD, site  # noqa: F401

pytestmark = pytest.mark.integration


def png(size=(300, 200)):
    buffer = BytesIO()
    Image.new("RGB", size, (10, 120, 60)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def restore_site(site):  # noqa: F811
    yield site
    app = site[0].app
    with app.state.session_factory.begin() as db:
        db.execute(delete(SiteImage))
        row = db.get(SiteSettings, 1)
        for key, value in DEFAULTS.items():
            setattr(row, key, value)


def test_site_settings_permissions_patch_and_images(restore_site, monkeypatch):
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, _, admin_headers, _, _, _, settings, _ = restore_site
    read = visitor.get("/api/v1/site")
    assert read.status_code == 200
    assert read.json()["data"] == {**DEFAULTS, "favicon_url": None, "logo_url": None}

    assert visitor.patch("/api/v1/site", json={"title": "x"}).status_code in (401, 403)
    assert admin.patch("/api/v1/site", json={"title": "x"}).status_code == 403  # no CSRF
    bad = admin.patch("/api/v1/site", json={"title": "  "}, headers=admin_headers)
    assert bad.status_code == 422
    changed = admin.patch(
        "/api/v1/site",
        json={"title": "  晨跑站 ", "default_theme": "dark", "subtitle": ""},
        headers=admin_headers,
    )
    assert changed.status_code == 200, changed.text
    data = changed.json()["data"]
    assert (data["title"], data["default_theme"], data["subtitle"]) == ("晨跑站", "dark", "")
    assert visitor.get("/api/v1/site").json()["data"]["title"] == "晨跑站"

    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"site-{suffix}@example.com",
        username=f"st_{suffix}",
        display_name="合成站点读者",
        timezone="UTC",
        password=PASSWORD,
    )
    assert admin.post("/api/v1/admin/users", json=payload, headers=admin_headers).status_code == 201
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as ordinary:
        logged = login(ordinary, payload["email"])
        headers = write_headers(logged)
        assert ordinary.patch("/api/v1/site", json={"title": "x"}, headers=headers).status_code == 403
        assert (
            ordinary.put(
                "/api/v1/site/images/logo",
                files={"file": ("a.png", png(), "image/png")},
                headers=headers,
            ).status_code
            == 403
        )

    uploaded = admin.put(
        "/api/v1/site/images/logo",
        files={"file": ("logo.png", png(), "image/png")},
        headers=admin_headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    logo_url = uploaded.json()["data"]["logo_url"]
    assert logo_url.startswith("/api/v1/site/images/logo?v=") and len(logo_url.split("=")[1]) == 16
    image = visitor.get(logo_url)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.size == (200, 200)
    assert visitor.get("/api/v1/site/images/favicon").status_code == 404
    assert visitor.get("/api/v1/site/images/other").status_code == 404
    unsupported = admin.put(
        "/api/v1/site/images/favicon",
        files={"file": ("a.svg", b"<svg/>", "image/svg+xml")},
        headers=admin_headers,
    )
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "IMAGE_UNSUPPORTED"
    oversized = admin.put(
        "/api/v1/site/images/favicon",
        content=b"\0" * (6 * 1024 * 1024 + 1),
        headers={**admin_headers, "Content-Type": "application/octet-stream"},
    )
    assert oversized.status_code == 413
    removed = admin.delete("/api/v1/site/images/logo", headers=admin_headers)
    assert removed.status_code == 200 and removed.json()["data"]["logo_url"] is None
    assert visitor.get("/api/v1/site/images/logo").status_code == 404
```

- [ ] **Step 10: 运行集成测试**：「运行集成测试 tests/integration/test_site_settings.py」，Expected PASS；再跑 Ruff 两项与 `git diff --stat`。不提交。

---

### Task 4: 用户头像与展示 profile

**Files:**
- Modify: `backend/app/modules/users/schema.py`、`users/service.py`、`users/router.py`、`backend/app/modules/admin_users/service.py`、`backend/app/modules/showcase/schema.py`、`showcase/router.py`、`backend/tests/integration/test_admin_users.py:97`
- Test: `backend/tests/unit/test_site_settings.py`（追加）、`backend/tests/integration/test_avatars.py`（新建）

**Interfaces:**
- Consumes: Task 1 `normalize_image`、`image_version`；Task 2 `UserAvatar`、`User.avatar_version`；Task 3 `png_response`、`read_upload`（`app.modules.site_settings.router`）。
- Produces:
  - `UserView.avatar_url: str | None = None`；`view()` 设为 `/api/v1/me/avatar?v=<avatar_version>` 或 `None`；`admin_view` 显式置 `None`。
  - `ShowcaseProfile.avatar_url: str | None`；根路径 `/api/v1/showcase/avatar?v=…`、具名 `/api/v1/showcase/users/{username}/avatar?v=…`。
  - users service：`put_avatar(db, user_id, raw) -> str`（返回 avatar_url）、`remove_avatar(db, user_id) -> None`、`avatar_bytes(db, user_id) -> bytes`（无图 404）。
  - 端点：`PUT/DELETE /api/v1/me/avatar` → `ApiResponse[AvatarView]`（`AvatarView(avatar_url: str | None)`）；`GET /api/v1/me/avatar` → PNG；`GET /api/v1/showcase/avatar`（及具名自动复制）→ PNG。

- [ ] **Step 1: 失败单测**（追加到 `tests/unit/test_site_settings.py`）：

```python
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.modules.admin_users.service import admin_view
from app.modules.users.service import view


def person(version):
    return SimpleNamespace(
        id=uuid4(), email_normalized="p@example.com", username="person", display_name="P",
        timezone="UTC", bio="", profile_is_public=False, is_active=True, showcase_enabled=False,
        created_at=datetime(2026, 1, 1, tzinfo=UTC), avatar_version=version,
    )


def test_user_view_avatar_url_points_to_own_endpoint_and_admin_list_hides_it():
    settings = SimpleNamespace(site_owner_email="owner@example.com")
    assert view(person(None), settings).avatar_url is None
    assert view(person("0123456789abcdef"), settings).avatar_url == (
        "/api/v1/me/avatar?v=0123456789abcdef"
    )
    assert admin_view(person("0123456789abcdef"), settings).avatar_url is None
```

（`tests/unit/test_admin_users.py` 的 `user()` 辅助若被 `view()` 调用，需补 `avatar_version=None` 属性；运行全量单测发现即补。）

- [ ] **Step 2: 运行确认失败**：`.venv/bin/pytest tests/unit/test_site_settings.py -q`。

- [ ] **Step 3: 实现**
  - `users/schema.py`：`UserView` 增加 `avatar_url: str | None = None`；新增 `class AvatarView(BaseModel): avatar_url: str | None`。
  - `users/service.py`：`view()` 增加 `avatar_url=f"/api/v1/me/avatar?v={user.avatar_version}" if getattr(user, "avatar_version", None) else None`（`getattr` 兼容既有单测桩对象）；并追加：

```python
from sqlalchemy import select

from app.modules.site_settings.images import image_version, normalize_image
from app.modules.users.model import User, UserAvatar


def put_avatar(db, user_id, raw):
    processed = normalize_image(raw, "avatar")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    avatar = db.get(UserAvatar, user_id)
    if avatar is None:
        avatar = UserAvatar(user_id=user_id)
        db.add(avatar)
    avatar.png_bytes, avatar.sha256 = processed.png, processed.sha256
    user.avatar_version = image_version(processed.sha256)
    db.flush()
    return f"/api/v1/me/avatar?v={user.avatar_version}"


def remove_avatar(db, user):
    avatar = db.get(UserAvatar, user.id)
    if avatar is not None:
        db.delete(avatar)
    user.avatar_version = None
    db.flush()


def avatar_bytes(db, user_id):
    data = db.scalar(select(UserAvatar.png_bytes).where(UserAvatar.user_id == user_id))
    if data is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "头像不存在")
    return data
```

  （`update` 已从 sqlalchemy 导入，合并 import 行。若出现循环导入，把 `site_settings.images` 的导入移到函数内部并在报告说明。）
  - `admin_users/service.py` `admin_view`：`AdminUser(**{**view(user, settings).model_dump(), "avatar_url": None}, is_active=...)`。
  - `users/router.py` 追加（import `AvatarView`、`Request`、`run_in_threadpool`、`png_response, read_upload`）：

```python
@router.put("/avatar", response_model=ApiResponse[AvatarView])
async def upload_avatar(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    owner = identity[1].id
    db.commit()  # Release the identity lock before reading and decoding the upload.
    raw = await read_upload(request)
    url = await run_in_threadpool(service.put_avatar, db, owner, raw)
    await run_in_threadpool(db.commit)
    return envelope(request, AvatarView(avatar_url=url))


@router.delete("/avatar", response_model=ApiResponse[AvatarView])
def delete_avatar(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    service.remove_avatar(db, identity[1])
    db.commit()
    return envelope(request, AvatarView(avatar_url=None))


@router.get("/avatar")
def own_avatar(
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.avatar_bytes(db, identity[1].id)
    db.commit()
    return png_response(data)
```

  - `showcase/schema.py`：`ShowcaseProfile` 增加 `avatar_url: str | None = None`。
  - `showcase/router.py`：`profile` 改为：

```python
def avatar_path(request: Request, owner: User) -> str | None:
    if not owner.avatar_version:
        return None
    username = request.path_params.get("username")
    base = "/api/v1/showcase" + (f"/users/{quote(username, safe='')}" if username else "")
    return f"{base}/avatar?v={owner.avatar_version}"


@router.get("/profile", response_model=ApiResponse[ShowcaseProfile])
def profile(request: Request, owner: Owner):
    return envelope(
        request,
        ShowcaseProfile(
            display_name=owner.display_name,
            timezone=owner.timezone,
            avatar_url=avatar_path(request, owner),
        ),
    )


@router.get("/avatar")
def avatar(owner: Owner, db: DB):
    from app.modules.site_settings.router import png_response
    from app.modules.users.service import avatar_bytes

    return png_response(avatar_bytes(db, owner.id))
```

  （`from urllib.parse import quote`；`avatar` 路由必须定义在文件末尾 `for existing_route in router.routes` 复制循环之前，以便具名路由自动获得。）
  - `tests/integration/test_admin_users.py:97` 断言改为 `== {"display_name", "timezone", "avatar_url"}`。

- [ ] **Step 4: 单测通过**：`.venv/bin/pytest tests/unit -q`。

- [ ] **Step 5: 集成测试** `backend/tests/integration/test_avatars.py`：

```python
"""Per-user avatars: own read/write, public showcase boundary and cascade."""

from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from app.main import create_app
from app.modules.users.model import UserAvatar
from tests.integration.test_admin_users import login, write_headers
from tests.integration.test_showcase import ORIGIN, PASSWORD, site  # noqa: F401

pytestmark = pytest.mark.integration


def jpeg():
    buffer = BytesIO()
    Image.new("RGB", (800, 600), (20, 40, 200)).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_avatar_lifecycle_and_public_boundary(site, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, _, admin_headers, _, _, _, settings, _ = site
    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"avatar-{suffix}@example.com",
        username=f"av_{suffix}",
        display_name="合成头像用户",
        timezone="UTC",
        password=PASSWORD,
    )
    created = admin.post("/api/v1/admin/users", json=payload, headers=admin_headers)
    identifier = created.json()["data"]["id"]
    named = f"/api/v1/showcase/users/{payload['username']}"
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as own:
        headers = write_headers(login(own, payload["email"]))
        assert own.get("/api/v1/me/avatar").status_code == 404
        assert visitor.get("/api/v1/me/avatar").status_code == 401
        assert (
            own.put("/api/v1/me/avatar", files={"file": ("a.jpg", jpeg(), "image/jpeg")}).status_code
            == 403
        )  # missing CSRF
        uploaded = own.put(
            "/api/v1/me/avatar", files={"file": ("a.jpg", jpeg(), "image/jpeg")}, headers=headers
        )
        assert uploaded.status_code == 200, uploaded.text
        url = uploaded.json()["data"]["avatar_url"]
        assert url.startswith("/api/v1/me/avatar?v=")
        assert own.get("/api/v1/me").json()["data"]["avatar_url"] == url
        image = own.get(url)
        assert image.status_code == 200 and image.headers["content-type"] == "image/png"
        with Image.open(BytesIO(image.content)) as decoded:
            assert decoded.size == (512, 512)

        # Not public until the showcase is enabled; same 404 as a missing account.
        assert visitor.get(named + "/avatar").status_code == 404
        assert visitor.get("/api/v1/showcase/users/no_such_user_x/avatar").status_code == 404
        admin.patch(
            f"/api/v1/admin/users/{identifier}", json={"showcase_enabled": True}, headers=admin_headers
        )
        profile = visitor.get(named + "/profile").json()["data"]
        assert profile["avatar_url"] == f"{named}/avatar?v={url.split('=')[1]}"
        assert visitor.get(profile["avatar_url"]).status_code == 200
        listing = admin.get("/api/v1/admin/users", params={"search": payload["username"]})
        assert listing.json()["data"]["items"][0]["avatar_url"] is None

        removed = own.delete("/api/v1/me/avatar", headers=headers)
        assert removed.status_code == 200 and removed.json()["data"] == {"avatar_url": None}
        assert visitor.get(named + "/avatar").status_code == 404
        assert visitor.get(named + "/profile").json()["data"]["avatar_url"] is None
        own.put("/api/v1/me/avatar", files={"file": ("a.jpg", jpeg(), "image/jpeg")}, headers=headers)
    deleted = admin.post(
        "/api/v1/admin/users/batch-delete", json={"ids": [identifier]}, headers=admin_headers
    )
    assert deleted.json()["data"]["deleted_count"] == 1
    with admin.app.state.session_factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(UserAvatar)
                .where(UserAvatar.user_id == UUID(identifier))
            )
            == 0
        )
```

- [ ] **Step 6: 运行**：「运行集成测试 tests/integration/test_avatars.py tests/integration/test_admin_users.py tests/integration/test_showcase.py tests/integration/test_auth.py」，Expected PASS；Ruff 两项；`git diff --stat`。不提交。

---

### Task 5: 前端数据层、hooks 注入与主题默认值

**Files:**
- Create: `frontend/src/lib/site.ts`、`frontend/src/lib/api/site.ts`
- Modify: `frontend/src/lib/api/auth.ts`、`frontend/src/lib/api/showcase.ts`、`frontend/src/app.d.ts`、`frontend/src/hooks.server.ts`、`frontend/src/routes/+layout.server.ts`、`frontend/src/app.html`、`frontend/src/lib/components/system-theme.ts`、`frontend/src/lib/components/ThemeToggle.svelte`、`frontend/tests/fixtures/ui-api.mjs`
- Test: `frontend/tests/unit/site.test.ts`（新建）、`frontend/tests/unit/system-theme.test.ts`（新建）

**Interfaces:**
- Consumes: 后端 `GET/PATCH /api/v1/site`、`PUT/DELETE /api/v1/site/images/{kind}`、`PUT/DELETE /api/v1/me/avatar`、`avatar_url` 字段。
- Produces:
  - `#lib/site.ts`：`interface Site { title; subtitle; footer_tagline; description: string; default_theme: SiteTheme; favicon_url: string | null; logo_url: string | null }`、`type SiteTheme = 'system'|'light'|'dark'`、`SITE_DEFAULTS: Site`、`pageTitle(name: string, site: Pick<Site,'title'> | null | undefined): string`（`${name} · ${title}`）、`brandInitial(title: string): string`（`Array.from(title.trim())[0] ?? 'R'`）。
  - `#lib/api/site.ts`：`SiteError`、`parseSite(value: unknown): Site`、`readSite(fetcher?)`、`updateSite(patch: Partial<Pick<Site,'title'|'subtitle'|'footer_tagline'|'description'|'default_theme'>>, fetcher?)`、`uploadSiteImage(kind: 'favicon'|'logo', file: File, fetcher?) : Promise<Site>`、`removeSiteImage(kind, fetcher?)`、`uploadAvatar(file: File, fetcher?): Promise<string>`、`removeAvatar(fetcher?): Promise<void>`、`safeImagePath(value: unknown): string | null`。
  - `User.avatar_url?: string | null`、`ShowcaseProfile.avatar_url?: string | null`。
  - `App.Locals.site: Site`；layout data `site: Site`。
  - `system-theme.ts`：`resolveTheme(preference: ThemePreference, siteDefault: SiteTheme, systemDark: boolean): 'light'|'dark'`、`siteDefaultTheme(): SiteTheme`（读 `document.documentElement.dataset.siteTheme`）。

- [ ] **Step 1: 失败单测** `frontend/tests/unit/site.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { SITE_DEFAULTS, brandInitial, pageTitle } from '../../src/lib/site.ts';
import { parseSite, safeImagePath, updateSite, uploadAvatar, uploadSiteImage } from '../../src/lib/api/site.ts';

const site = { ...SITE_DEFAULTS, title: '晨跑站', logo_url: '/api/v1/site/images/logo?v=0123456789abcdef' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: null }), { status });

describe('site contract', () => {
  it('formats titles and brand initials with defaults', () => {
    expect(pageTitle('数据汇总', site)).toBe('数据汇总 · 晨跑站');
    expect(pageTitle('数据汇总', null)).toBe('数据汇总 · RunNote');
    expect(brandInitial('晨跑站')).toBe('晨');
    expect(brandInitial('  ')).toBe('R');
  });
  it('accepts only same-origin fixed image paths', () => {
    expect(safeImagePath('/api/v1/site/images/favicon?v=0123456789abcdef')).toBe('/api/v1/site/images/favicon?v=0123456789abcdef');
    expect(safeImagePath('/api/v1/me/avatar?v=0123456789abcdef')).not.toBeNull();
    expect(safeImagePath('/api/v1/showcase/users/runner_2/avatar?v=0123456789abcdef')).not.toBeNull();
    for (const bad of ['https://evil.example/x.png', '//evil.example/a', '/api/v1/site/images/logo', 'javascript:alert(1)', '/api/v1/site/images/logo?v=0123456789abcdef&x=1', 5]) expect(safeImagePath(bad)).toBeNull();
  });
  it('rebuilds a whitelisted site object and rejects invalid fields', () => {
    expect(parseSite({ ...site, extra: 'drop' })).toEqual(site);
    for (const bad of [{ ...site, title: '' }, { ...site, title: 'x'.repeat(41) }, { ...site, default_theme: 'blue' }, { ...site, logo_url: 'https://evil.example/a.png' }, { ...site, description: 3 }])
      expect(() => parseSite(bad)).toThrow('站点设置服务返回了无效响应');
  });
  it('writes with fresh CSRF and multipart uploads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ csrf_token: 'a' })).mockResolvedValueOnce(response(site))
      .mockResolvedValueOnce(response({ csrf_token: 'b' })).mockResolvedValueOnce(response(site))
      .mockResolvedValueOnce(response({ csrf_token: 'c' })).mockResolvedValueOnce(response({ avatar_url: '/api/v1/me/avatar?v=0123456789abcdef' }));
    await updateSite({ title: '晨跑站' }, fetcher);
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/site');
    expect(fetcher.mock.calls[1][1].method).toBe('PATCH');
    expect(fetcher.mock.calls[1][1].headers['X-CSRF-Token']).toBe('a');
    const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });
    await uploadSiteImage('logo', file, fetcher);
    expect(fetcher.mock.calls[3][0]).toBe('/api/v1/site/images/logo');
    expect(fetcher.mock.calls[3][1].method).toBe('PUT');
    expect(fetcher.mock.calls[3][1].body).toBeInstanceOf(FormData);
    expect(await uploadAvatar(file, fetcher)).toBe('/api/v1/me/avatar?v=0123456789abcdef');
  });
});
```

`frontend/tests/unit/system-theme.test.ts`：

```ts
import { expect, it } from 'vitest';
import { resolveTheme } from '../../src/lib/components/system-theme.ts';

it('resolves local preference over site default over system', () => {
  expect(resolveTheme('light', 'dark', true)).toBe('light');
  expect(resolveTheme('dark', 'light', false)).toBe('dark');
  expect(resolveTheme('system', 'dark', false)).toBe('dark');
  expect(resolveTheme('system', 'light', true)).toBe('light');
  expect(resolveTheme('system', 'system', true)).toBe('dark');
  expect(resolveTheme('system', 'system', false)).toBe('light');
});
```

- [ ] **Step 2: 运行确认失败**：`pnpm exec vitest run tests/unit/site.test.ts tests/unit/system-theme.test.ts`。

- [ ] **Step 3: `src/lib/site.ts`**：

```ts
export type SiteTheme = 'system' | 'light' | 'dark';
export interface Site { title: string; subtitle: string; footer_tagline: string; description: string; default_theme: SiteTheme; favicon_url: string | null; logo_url: string | null }
export const SITE_DEFAULTS: Site = {
  title: 'RunNote', subtitle: '跑步与足迹', footer_tagline: '记录每一步，看见你的进步。',
  description: '汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。',
  default_theme: 'system', favicon_url: null, logo_url: null,
};
export const pageTitle = (name: string, site: Pick<Site, 'title'> | null | undefined) => `${name} · ${site?.title || SITE_DEFAULTS.title}`;
export const brandInitial = (title: string) => Array.from(title.trim())[0] ?? 'R';
```

- [ ] **Step 4: `src/lib/api/site.ts`**：

```ts
import { ActivityError, request } from './activities.ts';
import { SITE_DEFAULTS, type Site, type SiteTheme } from '../site.ts';

export class SiteError extends Error {
  constructor(message: string, public status = 502, public code = 'INVALID_RESPONSE') { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never { throw new SiteError('站点设置服务返回了无效响应'); }
const imagePath = /^\/api\/v1\/(?:site\/images\/(?:favicon|logo)|me\/avatar|showcase(?:\/users\/[a-z0-9_]{3,30})?\/avatar)\?v=[0-9a-f]{16}$/;
export const safeImagePath = (value: unknown): string | null => typeof value === 'string' && imagePath.test(value) ? value : null;
const limits = { title: 40, subtitle: 40, footer_tagline: 80, description: 200 } as const;
const themes: SiteTheme[] = ['system', 'light', 'dark'];
export function parseSite(value: unknown): Site {
  if (!object(value)) invalid();
  for (const [key, max] of Object.entries(limits)) { const text = value[key]; if (typeof text !== 'string' || text.length > max) invalid(); }
  if (!(value.title as string).trim() || !themes.includes(value.default_theme as SiteTheme)) invalid();
  const image = (key: 'favicon_url' | 'logo_url') => { const raw = value[key]; if (raw === null) return null; const safe = safeImagePath(raw); if (!safe) invalid(); return safe; };
  return { title: value.title as string, subtitle: value.subtitle as string, footer_tagline: value.footer_tagline as string, description: value.description as string, default_theme: value.default_theme as SiteTheme, favicon_url: image('favicon_url'), logo_url: image('logo_url') };
}
async function call(path: string, init: RequestInit, fetcher: typeof fetch, timeout?: number): Promise<unknown> {
  try { return await request(path, init, fetcher, timeout); }
  catch (cause) { if (cause instanceof ActivityError) throw new SiteError(cause.message, cause.status, cause.code); throw cause; }
}
async function csrf(fetcher: typeof fetch): Promise<string> {
  const value = await call('/api/v1/auth/csrf', {}, fetcher);
  if (!object(value) || typeof value.csrf_token !== 'string' || !value.csrf_token) invalid();
  return value.csrf_token;
}
export async function readSite(fetcher: typeof fetch = fetch): Promise<Site> { return parseSite(await call('/api/v1/site', {}, fetcher)); }
export async function updateSite(patch: Partial<Pick<Site, 'title' | 'subtitle' | 'footer_tagline' | 'description' | 'default_theme'>>, fetcher: typeof fetch = fetch): Promise<Site> {
  const token = await csrf(fetcher);
  return parseSite(await call('/api/v1/site', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(patch) }, fetcher));
}
const form = (file: File) => { const body = new FormData(); body.append('file', file); return body; };
export async function uploadSiteImage(kind: 'favicon' | 'logo', file: File, fetcher: typeof fetch = fetch): Promise<Site> {
  const token = await csrf(fetcher);
  return parseSite(await call(`/api/v1/site/images/${kind}`, { method: 'PUT', headers: { 'X-CSRF-Token': token }, body: form(file) }, fetcher, 20000));
}
export async function removeSiteImage(kind: 'favicon' | 'logo', fetcher: typeof fetch = fetch): Promise<Site> {
  const token = await csrf(fetcher);
  return parseSite(await call(`/api/v1/site/images/${kind}`, { method: 'DELETE', headers: { 'X-CSRF-Token': token } }, fetcher));
}
export async function uploadAvatar(file: File, fetcher: typeof fetch = fetch): Promise<string> {
  const token = await csrf(fetcher);
  const value = await call('/api/v1/me/avatar', { method: 'PUT', headers: { 'X-CSRF-Token': token }, body: form(file) }, fetcher, 20000);
  const url = object(value) ? safeImagePath(value.avatar_url) : null;
  if (!url || !url.startsWith('/api/v1/me/avatar?')) invalid();
  return url;
}
export async function removeAvatar(fetcher: typeof fetch = fetch): Promise<void> {
  const token = await csrf(fetcher);
  const value = await call('/api/v1/me/avatar', { method: 'DELETE', headers: { 'X-CSRF-Token': token } }, fetcher);
  if (!object(value) || value.avatar_url !== null) invalid();
}
export { SITE_DEFAULTS };
```

（若 `request()` 签名不接受第 4 个 timeout 参数，按 `activities.ts` 实际签名调整。）

- [ ] **Step 5: `auth.ts` / `showcase.ts`**：`User` 增加 `avatar_url?: string | null`；`parseUser` 末尾在返回对象中加入 `avatar_url: safeImagePath(v.avatar_url)`（从 `./site.ts` 导入；若 `parseUser` 当前直接返回 `v`，改为显式附加该字段，不改变其他字段校验）。`ShowcaseProfile` 增加 `avatar_url?: string | null`，`readShowcaseProfile` 返回 `{ display_name, timezone, avatar_url: safeImagePath(v.avatar_url) }`（白名单重建）。

- [ ] **Step 6: hooks 与 layout**
  - `app.d.ts` `Locals` 增加 `site: import('#lib/site.ts').Site`（或顶部 `import type { Site }`）。
  - `hooks.server.ts`：import `parseSite` 与 `SITE_DEFAULTS`；在 `event.locals.showcaseError = null;` 后加入：

```ts
  event.locals.site = SITE_DEFAULTS;
  try {
    const upstream = await backendRequest('/api/v1/site', event.request);
    const body = upstream.ok ? await upstream.json() : null;
    if (body?.data) event.locals.site = parseSite(body.data);
  } catch { /* Settings are cosmetic: fall back to built-in defaults. */ }
```

  工作区分支的 `event.locals.showcase` 增加 `avatar_url: event.locals.user.avatar_url ?? null`。在 `/admin/users` 403 行后加入：`if (/^\/settings\/site(?:\/|$)/.test(event.url.pathname) && !event.locals.user?.is_admin) return new Response('无权访问', { status: 403, headers: { 'Cache-Control': 'no-store' } });`。`resolve(event)` 改为：

```ts
  const site = event.locals.site;
  const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html
      .replace('%runnote.favicon%', escape(site.favicon_url ?? '/favicon.ico'))
      .replace('%runnote.theme%', site.default_theme),
  });
```

  （`default_theme` 已被 `parseSite` 限定为枚举值。）
  - `+layout.server.ts` 返回对象增加 `site: locals.site`。
  - `app.html`：favicon 行改为 `<link rel="icon" href="%runnote.favicon%" />`；首屏脚本改为：

```html
    <script>
      (() => {
        const site = '%runnote.theme%';
        const fallback = site === 'light' || site === 'dark' ? site : 'system';
        let preference = 'system';
        try { const saved = localStorage.getItem('runnote-theme'); if (saved === 'light' || saved === 'dark') preference = saved; } catch {}
        const root = document.documentElement;
        root.dataset.siteTheme = fallback;
        root.dataset.themePreference = preference;
        const effective = preference === 'system' ? fallback : preference;
        root.dataset.theme = effective === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : effective;
      })();
    </script>
```

  （`favicon.ico` 当前通过 `%sveltekit.assets%` 引用；`/favicon.ico` 在 adapter-node 下等价，确认 `static/favicon.ico` 仍可访问。）

- [ ] **Step 7: 主题模块**：`system-theme.ts` 增加：

```ts
import type { SiteTheme } from '../site.ts';
export function resolveTheme(preference: ThemePreference, siteDefault: SiteTheme, systemDark: boolean): 'light' | 'dark' {
  const effective = preference === 'system' ? siteDefault : preference;
  return effective === 'system' ? systemDark ? 'dark' : 'light' : effective;
}
export function siteDefaultTheme(): SiteTheme {
  const value = document.documentElement.dataset.siteTheme;
  return value === 'light' || value === 'dark' ? value : 'system';
}
```

  `applyTheme` 中 `root.dataset.theme = …` 改为 `root.dataset.theme = resolveTheme(value, siteDefaultTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches);`；`systemChanged` 保持仅在 `themePreference() === 'system'` 时重算（site 为 light/dark 时结果不变，无副作用）。`ThemeToggle.svelte`：自动按钮的 `aria-label`/`title` 改为 `siteDefaultTheme() === 'system' ? '跟随系统外观' : '恢复站点默认外观'`（在 `onMount`/`watchSystemTheme` 回调里读取到一个 `$state`，避免 SSR 访问 `document`）。

- [ ] **Step 8: 合成 API** `tests/fixtures/ui-api.mjs`：在模块顶部（`goals` 定义后）加入 `const site = { title: 'RunNote', subtitle: '跑步与足迹', footer_tagline: '记录每一步，看见你的进步。', description: '汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。', default_theme: 'system', favicon_url: null, logo_url: null };` 与 `const images = new Map(); const avatars = new Map();`（png Buffer），并在请求处理里**在 `/api/v1/admin/users` 分支之前**处理：
  - `GET /api/v1/site` → `send(site)`；`PATCH /api/v1/site`（需登录 `current?.is_admin` 且 `x-csrf-token === 'ui-csrf'`，否则 401/403）→ 合并允许字段后 `send(site)`；
  - `PUT /api/v1/site/images/(favicon|logo)`：读取原始请求体为 Buffer，存一个固定的 1×1 合成 PNG（`Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')`），版本取 `randomUUID().replace(/-/g,'').slice(0,16)`，设置 `site[kind + '_url']`；`DELETE` 置 null；`GET /api/v1/site/images/:kind` 返回 PNG（`res.writeHead(200, {'Content-Type':'image/png'})`）或 404；
  - `PUT/DELETE/GET /api/v1/me/avatar` 与 `GET /api/v1/showcase/avatar`、`/api/v1/showcase/users/:u/avatar`：同样以合成 PNG 实现，`current.avatar_url` / 账户的 `avatar_url` 字段随之更新；展示 profile 响应带 `avatar_url`（根路径用 `/api/v1/showcase/avatar?v=…`）。注意 named showcase 的 URL 重写发生在文件开头，avatar 路径需在重写前匹配或按重写后的 `/api/v1/showcase/avatar` 处理。
  - 不解析 multipart，不校验图片内容（合成夹具）。

- [ ] **Step 9: 运行**：`pnpm exec vitest run tests/unit/site.test.ts tests/unit/system-theme.test.ts` PASS；`pnpm test`；`pnpm check`；`pnpm exec playwright test --config playwright.ui.config.ts tests/ui/theme.spec.ts`（主题回归，含「跟随系统外观」按钮）与 `--config playwright.admin-users.config.ts`。`git diff --stat`。不提交。

---

### Task 6: 全站品牌、标签标题、描述、侧栏头像与分享海报

**Files:**
- Modify: `frontend/src/lib/components/AppNavigation.svelte`、`frontend/src/routes/+layout.svelte`、11 个含 `<title>` 的页面（`grep -rln "<title>" frontend/src/routes`）、`frontend/src/routes/dashboard/+page.svelte`（删除其 `<meta name="description">`）、`frontend/src/lib/share/route-poster-render.ts`、`frontend/src/lib/components/RoutePosterDialog.svelte`
- Test: `frontend/tests/ui/site-settings.spec.ts`（新建，渲染部分）、`frontend/playwright.site-settings.config.ts`（新建）

**Interfaces:**
- Consumes: Task 5 `page.data.site: Site`、`pageTitle`、`brandInitial`、`profile.avatar_url`。
- Produces: `renderPoster(data, palette, style = 'classic', brand: PosterBrand = { title: 'RunNote', logo: null })`，`interface PosterBrand { title: string; logo: ImageBitmap | null }`；`loadPosterLogo(url: string | null): Promise<ImageBitmap | null>`（`route-poster-render.ts`，2 秒超时，失败返回 null）。

- [ ] **Step 1: 测试配置** `frontend/playwright.site-settings.config.ts`：

```ts
import base from './playwright.ui.config.ts';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: ['site-settings.spec.ts'] });
```

（参照 `playwright.admin-users.config.ts` 的实际写法，保持一致。）

- [ ] **Step 2: 失败 UI 测试** `frontend/tests/ui/site-settings.spec.ts`（渲染部分；Task 7 继续追加）：

```ts
import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

const csrf = { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.afterEach(async ({ page }) => {
  await page.request.patch('/api/v1/site', { headers: csrf, data: { title: 'RunNote', subtitle: '跑步与足迹', footer_tagline: '记录每一步，看见你的进步。', default_theme: 'system' } });
  await page.request.delete('/api/v1/site/images/logo', { headers: csrf });
  await page.request.delete('/api/v1/site/images/favicon', { headers: csrf });
});

test('site title, subtitle, footer, tab title and logo follow settings', async ({ page }) => {
  await loginRunner(page);
  expect((await page.request.patch('/api/v1/site', { headers: csrf, data: { title: '晨跑站', subtitle: '每日训练', footer_tagline: '坚持就是胜利' } })).status()).toBe(200);
  await page.goto('/dashboard');
  const sidebar = page.locator('.app-sidebar');
  await expect(sidebar.locator('.desktop-brand')).toContainText('晨跑站');
  await expect(sidebar.locator('.brand-mark')).toHaveText('晨');
  await expect(sidebar.locator('.nav-caption')).toHaveText('每日训练');
  await expect(page.locator('.app-footer')).toContainText('坚持就是胜利');
  await expect(page).toHaveTitle('数据汇总 · 晨跑站');
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  expect((await page.request.put('/api/v1/site/images/logo', { headers: csrf, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  expect((await page.request.put('/api/v1/site/images/favicon', { headers: csrf, multipart: { file: { name: 'f.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  await page.reload();
  await expect(sidebar.locator('.desktop-brand img')).toHaveAttribute('src', /^\/api\/v1\/site\/images\/logo\?v=[0-9a-f]{16}$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^\/api\/v1\/site\/images\/favicon\?v=/);
});

test('site default theme applies before local choice and local choice wins', async ({ page }) => {
  await loginRunner(page);
  await page.request.patch('/api/v1/site', { headers: csrf, data: { default_theme: 'dark' } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.setItem('runnote-theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => localStorage.removeItem('runnote-theme'));
});

test('sidebar shows the subject avatar and falls back to the initial', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/dashboard');
  await expect(page.locator('.runner-avatar')).toHaveText('晨');
  expect((await page.request.put('/api/v1/me/avatar', { headers: csrf, multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  await page.reload();
  await expect(page.locator('.runner-avatar img')).toHaveAttribute('alt', '晨跑者的头像');
  await page.request.delete('/api/v1/me/avatar', { headers: csrf });
});
```

（合成 API 中站主访问根路径时 profile 来自 `/api/v1/showcase/profile`；确保 Task 5 的合成 avatar 写入同时反映到站主 profile 的 `avatar_url`。若 `loginRunner` 后首页实际路径不同，按实际调整。）

- [ ] **Step 3: 运行确认失败**：`pnpm exec playwright test --config playwright.site-settings.config.ts`。

- [ ] **Step 4: 品牌与页脚**
  - `AppNavigation.svelte`：`import { page } from '$app/state'; import { brandInitial } from '#lib/site.ts';`，`const site = $derived(page.data.site ?? SITE_DEFAULTS);`。两处品牌链接改为：

```svelte
<a href={view.href("/dashboard")} class="brand desktop-brand" aria-label={`${site.title} 数据汇总`}>{#if site.logo_url}<img class="brand-mark brand-logo" src={site.logo_url} alt="" width="32" height="32" />{:else}<span class="brand-mark" aria-hidden="true">{brandInitial(site.title)}</span>{/if}{site.title}</a>
```

  （移动栏同理，保留各自 class。）`<p class="nav-caption">` 内容改为 `{site.subtitle}`，为空时不渲染该 `<p>`。头像：

```svelte
{#if sports}<div class="runner-avatar" aria-hidden={!profile?.avatar_url || avatarFailed}>{#if checking}…{:else if profile?.avatar_url && !avatarFailed}<img src={profile.avatar_url} alt={`${profile.display_name}的头像`} onerror={() => avatarFailed = true} />{:else}{Array.from(profile?.display_name || '跑者')[0]}{/if}</div>{/if}
```

  `let avatarFailed = $state(false); $effect(() => { void profile?.avatar_url; avatarFailed = false; });`。样式（组件 `<style>`）：`.runner-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; } .brand-logo { object-fit: cover; padding: 0; background: transparent; }`。
  - `+layout.svelte`：公开顶栏品牌同上（用 `page.data.site`）；页脚 `<footer class="app-footer"><span>{site.title}</span>{#if site.footer_tagline}<span>{site.footer_tagline}</span>{/if}</footer>`；`<svelte:head>` 增加 `<meta name="description" content={site.description} />`（若 layout 尚无 `svelte:head` 则新增）。
  - `dashboard/+page.svelte`：删除 `<meta name="description" …>`。

- [ ] **Step 5: 标签标题**：对 `grep -rln "<title>" src/routes` 的每个文件，把 `<title>X · Run Note</title>` / `<title>X · RunNote</title>` 改为 `<title>{pageTitle(X, page.data.site)}</title>`（X 为原表达式，如 `'数据汇总'` 或 `activity?.title || '活动详情'`），并补 `import { pageTitle } from '#lib/site.ts';` 与 `import { page } from '$app/state';`（已有则复用）。完成后 `grep -rn "Run Note\|RunNote" src/routes src/lib/components` 应只剩无关注释或无结果。

- [ ] **Step 6: 海报**：`route-poster-render.ts`：

```ts
export interface PosterBrand { title: string; logo: ImageBitmap | null }
export async function loadPosterLogo(url: string | null): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch { return null; }
}
```

  `renderPoster` 增加第 4 个参数 `brand: PosterBrand = { title: 'RunNote', logo: null }`；品牌绘制改为：有 `brand.logo` 时 `ctx.save(); ctx.beginPath(); ctx.roundRect(54, 42, 48, 48, 14); ctx.clip(); ctx.drawImage(brand.logo, 54, 42, 48, 48); ctx.restore();`，否则保留原 `panel(...)` + 首字（`brandInitial(brand.title)`）；`text('RunNote', …)` 改为 `text(brand.title, 118, 79, 35, palette.foreground, 650, 640)`。`RoutePosterDialog.svelte`：打开时（已有的加载流程中）`logo = await loadPosterLogo(page.data.site?.logo_url ?? null)`（存 `$state<ImageBitmap | null>`，卸载时 `logo?.close()`），调用改为 `renderPoster(data, palette, style, { title: page.data.site?.title || 'RunNote', logo })`。

- [ ] **Step 7: 运行**：`pnpm exec playwright test --config playwright.site-settings.config.ts` PASS；`pnpm check`、`pnpm test`；回归 `pnpm exec playwright test --config playwright.route-poster.config.ts`、`--config playwright.admin-users.config.ts`、`--config playwright.ui.config.ts tests/ui/theme.spec.ts tests/ui/dashboard.spec.ts`（实际存在的配置名以 `ls frontend/playwright.*.config.ts` 为准）。若既有用例断言了 "RunNote" 文案且默认值下仍应通过；失败则查明原因，不改断言掩盖回归。`git diff --stat`。不提交。

---

### Task 7: 设置页拆分、ImageUpload 组件与站点设置页

**Files:**
- Create: `frontend/src/lib/components/ImageUpload.svelte`、`frontend/src/lib/components/SettingsTabs.svelte`、`frontend/src/routes/settings/site/+page.svelte`
- Modify: `frontend/src/routes/settings/+page.svelte`、`frontend/tests/fixtures/ui-showcase/Showcase.svelte`、`docs/design-system/components.md`
- Test: `frontend/tests/ui/site-settings.spec.ts`（追加）

**Interfaces:**
- Consumes: Task 5 `#lib/api/site.ts` 全部函数、`Site`；`page.data.user`、`page.data.site`。
- Produces: `ImageUpload` props：`{ label: string; src: string | null; fallback: string; shape?: 'circle' | 'square'; busy?: boolean; error?: string; hint?: string; onselect: (file: File) => void; onremove: () => void }`；`SettingsTabs` props：`{ current: 'account' | 'site' }`（站点链接仅 `page.data.user?.is_admin` 时渲染，固定 href `/settings/site`，账户链接用 `view.href('/settings')`）。

- [ ] **Step 1: 先读规范**：`docs/design-system/README.md`、`components.md`、`patterns.md`、`tokens.md`。Tabs 规则：模式切换用链接/按钮组，不加 `role=tab`。

- [ ] **Step 2: 失败 UI 测试**（追加到 `site-settings.spec.ts`）：

```ts
test('owner edits site settings from the site settings page', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings');
  const tabs = page.getByRole('navigation', { name: '设置分区' });
  await expect(tabs.getByRole('link', { name: '账户设置', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: '站点设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/site$/);
  await expect(page.getByRole('heading', { level: 1, name: '站点设置' })).toBeVisible();
  await page.getByLabel('站点标题', { exact: true }).fill('晨跑站');
  await page.getByLabel('侧栏副标题', { exact: true }).fill('');
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已保存。', { exact: true })).toBeVisible();
  await expect(page.locator('.app-sidebar .desktop-brand')).toContainText('晨跑站');
  await expect(page.locator('.app-sidebar .nav-caption')).toHaveCount(0);
  await page.getByLabel('上传站内标志').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.app-sidebar .desktop-brand img')).toBeVisible();
  await page.getByRole('button', { name: '恢复默认站内标志', exact: true }).click();
  await expect(page.locator('.app-sidebar .desktop-brand img')).toHaveCount(0);
  await page.getByLabel('站点标题', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByLabel('站点标题', { exact: true })).toHaveJSProperty('validity.valueMissing', true);
});

test('account settings upload and remove the avatar', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings');
  await page.getByLabel('上传头像').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.runner-avatar img')).toBeVisible();
  await page.getByRole('button', { name: '移除头像', exact: true }).click();
  await expect(page.locator('.runner-avatar img')).toHaveCount(0);
});

test('ordinary users have no site settings entry and get 403', async ({ page, browser }) => {
  await loginRunner(page);
  const username = `ui_site_${Date.now().toString(36)}`;
  await page.request.post('/api/v1/admin/users', { headers: csrf, data: { email: `${username}@example.com`, username, display_name: '普通站点用户', timezone: 'Asia/Shanghai', password: 'Synthetic-only-password', is_active: true, showcase_enabled: false } });
  const context = await browser.newContext(); const own = await context.newPage();
  try {
    await own.goto('/admin');
    await own.getByLabel('邮箱', { exact: true }).fill(`${username}@example.com`);
    await own.getByLabel('密码', { exact: true }).fill('Synthetic-only-password');
    await own.getByRole('button', { name: '登录', exact: true }).click();
    await own.goto('/workspace/settings');
    await expect(own.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '站点设置' })).toHaveCount(0);
    await expect(own.getByLabel('上传头像')).toBeVisible();
    expect((await own.goto('/settings/site'))?.status()).toBe(403);
  } finally { await context.close(); }
});
```

注：`toHaveJSProperty('validity.valueMissing')` 若 Playwright 不支持点路径，改为 `expect(await page.getByLabel('站点标题').evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true)`。

- [ ] **Step 3: 运行确认失败**：`pnpm exec playwright test --config playwright.site-settings.config.ts -g "site settings page|avatar|ordinary users"`。

- [ ] **Step 4: `ImageUpload.svelte`**：

```svelte
<script lang="ts">
  let { label, src, fallback, shape = 'square', busy = false, error = '', hint = '', onselect, onremove }: { label: string; src: string | null; fallback: string; shape?: 'circle' | 'square'; busy?: boolean; error?: string; hint?: string; onselect: (file: File) => void; onremove: () => void } = $props();
  const id = $props.id(); // SSR-stable: random ids would break label/input pairing after hydration.
  let failed = $state(false), input: HTMLInputElement;
  $effect(() => { void src; failed = false; });
</script>
<div class="image-upload" aria-busy={busy}>
  <div class="preview" class:circle={shape === 'circle'}>{#if src && !failed}<img {src} alt={`当前${label}`} onerror={() => failed = true} />{:else}<span aria-hidden="true">{fallback}</span><span class="sr-only">未设置{label}</span>{/if}</div>
  <div class="controls">
    <label for={id} class="button-secondary" class:disabled={busy}>{busy ? '上传中…' : `选择${label}`}</label>
    <input bind:this={input} {id} class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label={`上传${label}`} disabled={busy} onchange={() => { const file = input.files?.[0]; input.value = ''; if (file) onselect(file); }} />
    {#if src}<button type="button" class="button-secondary" disabled={busy} onclick={onremove}>{shape === 'circle' ? `移除${label}` : `恢复默认${label}`}</button>{/if}
    {#if hint}<p class="text-sm text-muted-foreground">{hint}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
</div>
<style>
  .image-upload { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
  .preview { display: grid; place-items: center; width: 4rem; height: 4rem; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--muted-foreground); font-size: 1.5rem; font-weight: 700; }
  .preview.circle { border-radius: 50%; }
  .preview img { width: 100%; height: 100%; object-fit: cover; }
  .controls { display: grid; gap: var(--space-2); min-width: 0; }
  label.disabled { opacity: .5; pointer-events: none; }
  input:focus-visible + * , label:has(+ input:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
```

（可见焦点：隐藏的 file input 获得焦点时需在 label 上显示焦点环；若 `:has` 选择器在项目目标浏览器不可用，改用 `onfocus/onblur` 切换 class。头像用 `label="头像"`、`shape="circle"`；站点用 `label="站内标志"` / `label="浏览器图标"`。）

- [ ] **Step 5: `SettingsTabs.svelte`**：

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  let { current }: { current: 'account' | 'site' } = $props();
  const view = useViewContext();
</script>
<nav aria-label="设置分区" class="settings-tabs">
  <a href={view.href('/settings')} class="button-secondary" aria-current={current === 'account' ? 'page' : undefined}>账户设置</a>
  {#if page.data.user?.is_admin}<a href="/settings/site" class="button-secondary" aria-current={current === 'site' ? 'page' : undefined}>站点设置</a>{/if}
</nav>
<style>
  .settings-tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
  .settings-tabs [aria-current='page'] { background: var(--sport-nav-active); color: var(--sport-nav-active-ink); }
</style>
```

- [ ] **Step 6: 账户设置页** `routes/settings/+page.svelte`：`PageHeader` 之后加入 `<SettingsTabs current="account" />`；在「账户信息」section 之后新增头像 section：

```svelte
  <section class="aux-panel mt-6" aria-labelledby="avatar-title">
    <h2 id="avatar-title" class="text-xl font-semibold">头像</h2>
    <p class="mt-2 text-sm text-muted-foreground">支持 PNG、JPEG、WebP，不超过 5 MiB；自动居中裁成正方形，并移除照片中的位置等元数据。开启个人展示后访客可见。</p>
    <div class="mt-4"><ImageUpload label="头像" shape="circle" src={avatarUrl} fallback={Array.from(page.data.user.display_name || '跑者')[0]} busy={avatarBusy} error={avatarError} onselect={file => void changeAvatar(file)} onremove={() => void clearAvatar()} /></div>
  </section>
```

  脚本：`let avatarUrl = $state<string | null>(page.data.user?.avatar_url ?? null), avatarBusy = $state(false), avatarError = $state('');`；

```ts
  async function changeAvatar(file: File) {
    if (avatarBusy) return; avatarBusy = true; avatarError = '';
    try { const url = await uploadAvatar(file, fetch); if (disposed) return; avatarUrl = url; await invalidateAll(); }
    catch (cause) { if (disposed) return; if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return; } avatarError = cause instanceof Error ? cause.message : '头像上传失败，请重试'; }
    finally { if (!disposed) avatarBusy = false; }
  }
  async function clearAvatar() {
    if (avatarBusy) return; avatarBusy = true; avatarError = '';
    try { await removeAvatar(fetch); if (disposed) return; avatarUrl = null; await invalidateAll(); }
    catch (cause) { if (disposed) return; if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return; } avatarError = cause instanceof Error ? cause.message : '移除失败，请重试'; }
    finally { if (!disposed) avatarBusy = false; }
  }
```

  注意：此页 `fetch` 是 `view.fetch`（工作区上下文会改写 `/api/v1/showcase/*` 路径；`/api/v1/me/avatar` 不受影响）。`invalidateAll()` 让 hooks 重新读取 session（含 `avatar_url`）与展示 profile，从而刷新侧栏头像。

- [ ] **Step 7: 站点设置页** `routes/settings/site/+page.svelte`：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import ImageUpload from '#lib/components/ImageUpload.svelte';
  import SettingsTabs from '#lib/components/SettingsTabs.svelte';
  import { SiteError, readSite, removeSiteImage, updateSite, uploadSiteImage } from '#lib/api/site.ts';
  import { brandInitial, pageTitle, type Site, type SiteTheme } from '#lib/site.ts';

  let site = $state<Site | null>(null), loading = $state(true), loadError = $state('');
  let title = $state(''), subtitle = $state(''), tagline = $state(''), description = $state(''), theme = $state<SiteTheme>('system');
  let saving = $state(false), notice = $state(''), error = $state('');
  let imageBusy = $state<'favicon' | 'logo' | null>(null), imageError = $state<Record<string, string>>({});
  let disposed = false, token = 0;
  const themes: { value: SiteTheme; label: string }[] = [{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }];

  function fill(value: Site) { site = value; title = value.title; subtitle = value.subtitle; tagline = value.footer_tagline; description = value.description; theme = value.default_theme; }
  function expired(cause: unknown) { if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return true; } return false; }
  async function load() {
    const request = ++token; loading = true; loadError = '';
    try { const value = await readSite(); if (disposed || request !== token) return; fill(value); }
    catch (cause) { if (disposed || request !== token || expired(cause)) return; loadError = cause instanceof Error ? cause.message : '站点设置读取失败'; }
    finally { if (!disposed && request === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; token++; }; });
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (saving) return; saving = true; notice = ''; error = '';
    try { const value = await updateSite({ title, subtitle, footer_tagline: tagline, description, default_theme: theme }); if (disposed) return; fill(value); notice = '站点设置已保存。'; await invalidateAll(); }
    catch (cause) { if (disposed || expired(cause)) return; error = cause instanceof Error ? cause.message : '保存失败，请重试'; }
    finally { if (!disposed) saving = false; }
  }
  async function change(kind: 'favicon' | 'logo', action: () => Promise<Site>) {
    if (imageBusy) return; imageBusy = kind; imageError = { ...imageError, [kind]: '' };
    try { const value = await action(); if (disposed) return; site = value; await invalidateAll(); }
    catch (cause) { if (disposed || expired(cause)) return; imageError = { ...imageError, [kind]: cause instanceof Error ? cause.message : '图片更新失败，请重试' }; }
    finally { if (!disposed) imageBusy = null; }
  }
</script>
<svelte:head><title>{pageTitle('站点设置', page.data.site)}</title></svelte:head>
<PageHeader title="站点设置" description="管理站点名称、标语、默认外观和图标。" />
<SettingsTabs current="site" />
{#if loading}<div class="mt-6"><FeedbackState kind="loading" title="正在读取站点设置…" /></div>
{:else if loadError}<div class="mt-6"><FeedbackState kind="error" title={loadError}><button type="button" class="button-secondary mt-3" onclick={() => void load()}>重新读取</button></FeedbackState></div>
{:else if site}
  <form onsubmit={save} class="aux-panel mt-6 space-y-5" aria-busy={saving}>
    <h2 class="text-xl font-semibold">文字</h2>
    <label class="block">站点标题<input required maxlength="40" bind:value={title} disabled={saving} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">侧栏副标题<input maxlength="40" bind:value={subtitle} disabled={saving} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">页脚标语<input maxlength="80" bind:value={tagline} disabled={saving} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">站点描述<textarea maxlength="200" rows="3" bind:value={description} disabled={saving} class="mt-2 block w-full rounded border p-2"></textarea></label>
    <fieldset class="space-y-2"><legend class="font-semibold">默认外观</legend><p class="text-sm text-muted-foreground">访客未在本机手动切换时使用；手动切换始终优先。</p>
      {#each themes as option}<label class="flex items-center gap-3"><input type="radio" name="default-theme" value={option.value} bind:group={theme} disabled={saving} />{option.label}</label>{/each}
    </fieldset>
    <button class="button-primary" disabled={saving}>{saving ? '保存中…' : '保存站点设置'}</button>
    {#if notice}<FeedbackState kind="success" title={notice} />{/if}{#if error}<FeedbackState kind="error" title={error} />{/if}
  </form>
  <section class="aux-panel mt-6 space-y-6" aria-labelledby="images-title">
    <h2 id="images-title" class="text-xl font-semibold">图标</h2>
    <p class="text-sm text-muted-foreground">支持 PNG、JPEG、WebP，不超过 5 MiB；自动居中裁成正方形并移除元数据。</p>
    <ImageUpload label="站内标志" src={site.logo_url} fallback={brandInitial(site.title)} busy={imageBusy === 'logo'} error={imageError.logo} hint="显示在侧栏、顶栏和分享图。" onselect={file => void change('logo', () => uploadSiteImage('logo', file))} onremove={() => void change('logo', () => removeSiteImage('logo'))} />
    <ImageUpload label="浏览器图标" src={site.favicon_url} fallback={brandInitial(site.title)} busy={imageBusy === 'favicon'} error={imageError.favicon} hint="显示在浏览器标签页。" onselect={file => void change('favicon', () => uploadSiteImage('favicon', file))} onremove={() => void change('favicon', () => removeSiteImage('favicon'))} />
  </section>
{/if}
```

  （`button-primary` 类已存在于设置页现有表单中；若不存在以页面现有主按钮写法为准。）

- [ ] **Step 8: showcase 与文档**：`tests/fixtures/ui-showcase/Showcase.svelte` 在「设置分组」示例附近新增一个 `<section class="aux-panel" aria-labelledby="upload-title"><h3 id="upload-title">图片上传</h3>` 展示两个 `ImageUpload`（一个 `src={null}` 圆形、一个带 `error` 文案方形；回调为空函数，不访问网络）。`docs/design-system/components.md` 组件表新增一行：`| ImageUpload | 头像/站内标志/浏览器图标上传 | 原生 file input + label；accept 仅 png/jpeg/webp；预览失败回退字符；移除/恢复默认按钮；错误 role=alert；busy 禁用 |`，并在说明段落写明 `SettingsTabs` 遵循「模式切换用链接组 + aria-current，不加 role=tab」。

- [ ] **Step 9: 运行**：`pnpm exec playwright test --config playwright.site-settings.config.ts` 全部 PASS；`pnpm check`、`pnpm test`、`pnpm build`；`pnpm exec playwright test --config playwright.design-system.config.ts`：若因新增 showcase section 或品牌区改动出现截图差异，**不要更新基线**，记录差异文件名并以 DONE_WITH_CONCERNS 报告。回归 `--config playwright.admin-users.config.ts`。`git diff --stat`。不提交。

---

### Task 8: 特性文档与最终验证

**Files:**
- Create: `docs/61-site-settings.md`（先 `ls docs/ | grep -E '^[0-9]+' | sort -n | tail -1` 确认最大编号为 60，否则顺延）
- Modify: `docs/superpowers/specs/2026-10-18-site-settings-design.md`（验证记录节）

- [ ] **Step 1: 最终回归**（逐条记录命令与通过/失败/跳过数）：backend `pytest tests/unit -q`、Ruff 两项、`alembic heads`（应唯一 `0012_site_settings`）、「运行集成测试 tests/integration/test_site_settings.py tests/integration/test_avatars.py tests/integration/test_admin_users.py tests/integration/test_showcase.py tests/integration/test_auth.py tests/integration/test_migrations.py tests/integration/test_ai_reports.py」；frontend `pnpm test`、`pnpm check`、`pnpm build`、`playwright.site-settings.config.ts`、`playwright.admin-users.config.ts`、`playwright.ui.config.ts tests/ui/theme.spec.ts`、route-poster 配置、design-system 配置（差异只记录不更新）。任一失败：停止并报告，不改代码。

- [ ] **Step 2: 写 `docs/61-site-settings.md`**（中文）：「使用方式」（站主 `/settings/site`、所有用户 `/settings` 头像、默认主题优先级）、「接口与隐私」（端点表、权限、图片重编码去元数据、头像公开边界、不改 SSR 代理且图片响应 no-store、新增字段 `avatar_url`）、「部署注意」（新增 Pillow 依赖需 `uv pip sync requirements.lock`；新迁移 `0012_site_settings`：部署前 `/api/v1/health/ready` 为 503，开发库/生产库升级须另行授权并按备份→恢复演练→升级→复核）、「验证记录」（Step 1 实际结果；未运行项：ui-shell 既有 3 项失败、e2e、开发服务未重启、开发库未迁移）。

- [ ] **Step 3: 更新 spec 验证记录** 指向 `docs/61`，列同样结果。

- [ ] **Step 4: `git status --short` 与 `git diff --stat`**。不提交。
