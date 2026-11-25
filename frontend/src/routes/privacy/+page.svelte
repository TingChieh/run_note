<script lang="ts">
  import { page } from '$app/state';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { pageTitle } from '#lib/site.ts';

  const CONTACT_EMAIL = 'tingchieh77@outlook.com';
  const DELETION_SUBJECT = 'RunNote 账号删除请求';
  const DELETION_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(DELETION_SUBJECT)}`;
  const EFFECTIVE_DATE = '2026-11-25';
</script>

<svelte:head>
  <title>{pageTitle('隐私政策', page.data.site)}</title>
</svelte:head>

<div class="privacy-page">
  <PageHeader title="隐私政策">
    {#snippet actions()}
      <a class="button-secondary" href="#data-deletion">账号与数据删除 →</a>
    {/snippet}
  </PageHeader>

  <div class="aux-stack privacy-stack">
    <section class="aux-panel settings-block" aria-labelledby="privacy-overview-title">
      <div class="block-title-row">
        <h2 id="privacy-overview-title">基本信息与联系方式</h2>
        <span class="status-badge">生效日期：{EFFECTIVE_DATE}</span>
      </div>
      <p>
        本隐私政策说明个人项目 <strong>RunNote</strong>（包括 Web
        端与配套移动客户端）在提供跑步记录管理、统计分析与相关功能时，如何收集、使用、保存、保护你的数据，以及如何联系我们申请删除账号与数据。
      </p>
      <dl class="privacy-meta-grid">
        <div>
          <dt>运营方</dt>
          <dd>RunNote（个人项目）</dd>
        </div>
        <div>
          <dt>隐私与删除联系邮箱</dt>
          <dd><a class="privacy-link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></dd>
        </div>
        <div>
          <dt>最近更新与生效日期</dt>
          <dd>{EFFECTIVE_DATE}</dd>
        </div>
      </dl>
      <p class="block-hint">
        本页如实陈述 RunNote
        当前的数据处理方式与联系途径，不构成任何地区特定合规认证声明。如对数据处理有任何疑问，请通过上述邮箱联系。
      </p>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-data-collected-title">
      <h2 id="privacy-data-collected-title">我们收集与处理的数据</h2>

      <div class="privacy-subsection">
        <h3>1. 账号与身份信息</h3>
        <ul class="privacy-list">
          <li>注册与登录所需的电子邮箱、用户名、昵称/显示名、个人简介、系统生成的用户 ID（UUID）及时区设置。</li>
          <li>你主动上传的头像图片（服务端会解码、裁剪为正方形、移除 EXIF/位置元数据并重编码为 PNG）。</li>
          <li>
            使用 Argon2 算法单向哈希后的密码凭证（不存储明文密码），以及用于维持登录状态与防护跨站请求的会话记录。
          </li>
          <li>个人偏好与可见性设置（如公开主页、一起跑步、身心健康模块开关）。</li>
        </ul>
      </div>

      <div class="privacy-subsection">
        <h3>2. 跑步、运动与训练记录</h3>
        <ul class="privacy-list">
          <li>
            你主动导入（GPX、TCX、小米运动健康）、手动创建或在记录页使用 GPS 录制的运动记录，包括 GPS
            轨迹点与路线段、距离、用时、配速、心率、步频、步数、热量、最大摄氧量、训练负荷/效果、活动日期/时间与时区、标题、备注、分类及标签。
          </li>
          <li>跑鞋装备信息（鞋名、累计里程、替换阈值与活动关联）以及周/月/年跑量目标。</li>
          <li>跑步日记与配图（心情、体感强度 RPE、天气、文字笔记及重编码为 PNG 的日记照片）。</li>
          <li>
            <strong>可选私人身心健康日记</strong
            >：仅在管理员允许且你主动开启时使用，记录情绪、睡眠、症状、用药与备注。该模块数据严格私密，永不进入公开展示、分享、海报、AI
            助手上下文、本地离线缓存或系统日志。
          </li>
          <li>
            <strong>实时 GPS 录制</strong
            >：仅在你主动点击开始跑步并授予精确位置权限后于前台服务期间采集位置点（不申请后台始终定位权限）；录制草稿与待传队列暂存于本机并在上传成功后释放，退出登录或切换账号时自动清理。
          </li>
        </ul>
      </div>

      <div class="privacy-subsection" id="health-connect">
        <h3>3. Health Connect 只读健康数据（仅限设备本地）</h3>
        <p>
          在 Android 客户端中，当你主动连接并授权 <strong>Health Connect</strong> 时，RunNote 仅以<strong
            >严格只读</strong
          >方式申请以下 6 项基础指标权限，用于在应用内展示近期汇总参考（默认近 7 天，最长 30 天）：
        </p>
        <ul class="privacy-list">
          <li>步数（Steps）</li>
          <li>距离（Distance）</li>
          <li>活动热量（Active Calories Burned）</li>
          <li>心率（Heart Rate）</li>
          <li>静息心率（Resting Heart Rate）</li>
          <li>睡眠时长（Sleep）</li>
        </ul>
        <p class="block-hint">
          <strong>仅本机读取、不上传服务器</strong>：RunNote 仅在你的设备本地读取并汇总上述 6 项指标用于界面展示，<strong
            >不会</strong
          >向 Health Connect 写入或修改任何数据，<strong>不申请</strong>后台读取权限或运动轨迹权限，<strong>不会</strong
          >将 Health Connect 原始样本或汇总数值上传至 RunNote 服务器、写入日志或发送给任何第三方（包括 AI
          服务提供方）。本机浏览器存储仅保存不含健康数值的权限状态标记以检测系统撤销，并在退出登录时清除。
        </p>
      </div>

      <div class="privacy-subsection">
        <h3>4. 本机缓存与偏好</h3>
        <ul class="privacy-list">
          <li>外观主题（浅色/深色/跟随系统）与地图底图偏好仅保存在本机浏览器存储中。</li>
          <li>
            为支持离线浏览与增量同步，客户端会在本机 IndexedDB
            中按账号隔离缓存只读数据汇总、活动记录与足迹元数据（不缓存令牌、Cookie、原始 GPX/TCX
            文件、离线地图瓦片或身心健康日记）。退出登录、会话失效或切换账号时自动清除。
          </li>
        </ul>
      </div>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-purposes-title">
      <h2 id="privacy-purposes-title">我们如何使用这些数据</h2>
      <ul class="privacy-list">
        <li>
          提供核心应用功能：导入、录制、展示和统计你的跑步记录、路线足迹、个人最佳成绩、跑鞋里程、跑量目标与跑步日记。
        </li>
        <li>
          跨设备数据同步与离线查看：通过服务端数据库保存你的个人记录，并在本机缓存已同步数据以支持弱网或离线浏览。
        </li>
        <li>账号管理与安全防护：验证身份、维护登录会话、防范跨站请求伪造（CSRF）与暴力尝试、保障服务稳定运行。</li>
        <li>
          可选 AI
          跑步助手（仅在已登录、你主动发起对话且服务端已启用配置时）：结合你的提问与经严格白名单过滤的运动汇总指标生成参考回复。
        </li>
      </ul>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-sharing-title">
      <h2 id="privacy-sharing-title">数据共享与第三方服务</h2>
      <p>
        <strong>我们不出售你的个人数据，不投放第三方广告，也不向数据经纪商或广告网络共享你的数据。</strong>
        仅在提供和维持服务所必需的最小范围内，涉及以下服务提供方或公开机制：
      </p>
      <ul class="privacy-list">
        <li>
          <strong>服务器与数据库托管基础设施</strong>：RunNote 的应用服务与 PostgreSQL/PostGIS
          数据库部署在运营方所选的服务器托管基础设施上；如已启用异地容灾，还会将经客户端加密的数据库备份存储于受限对象存储（例如
          S3 兼容存储）。上述设施仅用于运行服务与灾备恢复。
        </li>
        <li>
          <strong>可选 AI 模型服务提供方</strong>：仅当你登录并主动向 AI 跑步助手发送消息（且站点已配置 AI 供应商，例如
          OpenAI 兼容接口 / DeepSeek）时，服务端才会通过 HTTPS 发送你的对话内容以及经白名单过滤的数值型运动汇总。<strong
            >绝不发送</strong
          >邮箱、用户名、密码、原始 GPX/TCX 文件、精确 GPS 坐标与路线、活动标题/标签/备注、日记照片、身心健康日记或
          Health Connect 数据。
        </li>
        <li>
          <strong>公开地图底图（OpenFreeMap）</strong>：开启外部底图时，浏览器仅向 OpenFreeMap
          请求公开的地图样式、字体、图标与当前视口瓦片（不附带登录凭据）。你的跑步轨迹 GeoJSON
          始终在浏览器本地绘制，不会发送给底图服务方，你也可随时关闭外部底图。
        </li>
        <li>
          <strong>主动开启的公开展示与分享</strong
          >：仅当你主动开启公开个人主页、单条活动分享、“一起跑步”，或站主为你开启个人完整展示时，对应范围内的内容才会对访客可见。私人备注、原始
          GPX/TCX 文件、跑鞋及身心健康日记永不公开。
        </li>
      </ul>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-retention-title">
      <h2 id="privacy-retention-title">存储、保存期限与备份</h2>
      <ul class="privacy-list">
        <li>
          <strong>主要业务数据</strong>：账号资料、运动记录、轨迹、日记照片、跑鞋、目标与（若启用）身心健康记录保存在
          RunNote 服务端数据库中，在账号有效期间持续保留，直至你自行删除相应记录或提出账号删除请求。
        </li>
        <li>
          <strong>登录会话</strong>：已登录会话 Cookie（HttpOnly）有效期为 7 天，匿名防跨站会话为 10
          分钟；退出登录、修改密码或停用账号后会立即失效。
        </li>
        <li>
          <strong>本机缓存与草稿</strong
          >：本机离线缓存与未上传录制草稿在退出登录、会话失效或切换账号时自动清理；你也可以随时在「设置 →
          目标与隐私」中手动清除本地缓存。
        </li>
        <li>
          <strong>数据库备份与轮转</strong
          >：为防范故障与意外丢失，服务端会按计划生成逻辑数据库备份，并可配置客户端加密的异地备份快照。按项目默认运维脚本策略，本地备份默认保留最近
          14 份每日备份及若干发布前备份，加密异地备份默认按 7 日 / 4 周 / 6
          月的轮转周期保留（具体部署实例的实际保留数量可能因运维配置而异）。从生产数据库删除数据后，既有备份中的历史副本会在对应轮转周期到期后自动覆盖或清除，期间不会被重新启用或用于业务目的。
        </li>
      </ul>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-security-title">
      <h2 id="privacy-security-title">安全保护措施</h2>
      <ul class="privacy-list">
        <li>传输安全：生产环境强制使用 HTTPS 加密传输，移动客户端校验服务端 TLS 证书，拒绝不安全连接。</li>
        <li>
          身份与访问控制：密码采用 Argon2 哈希存储，会话 Cookie 启用 HttpOnly、SameSite 及生产环境 Secure 标志，写操作受
          CSRF 令牌与请求来源双重校验及频率限制保护，服务端按用户身份严格隔离资源访问。
        </li>
        <li>
          最小权限与隐私保护：Health Connect 严格限定 6 项只读权限且零写入/零后台读取；GPS
          录制仅限前台服务且锁屏通知脱敏；上传头像与图片经重编码剥离 EXIF 位置元数据；AI
          对外请求实行字段白名单与敏感键拦截。
        </li>
      </ul>
      <p class="block-hint">
        尽管我们采取上述合理技术措施保护你的数据，但互联网传输与电子存储均无法保证绝对安全。如发现潜在安全风险，请尽快通过
        <a class="privacy-link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> 通知我们。
      </p>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-rights-title">
      <h2 id="privacy-rights-title">你的权利与选择</h2>
      <ul class="privacy-list">
        <li>
          <strong>访问与查看</strong>：登录后可随时在应用内查看个人资料、运动记录、统计分析与（如已启用）身心健康数据及
          CSV 导出报告。
        </li>
        <li>
          <strong>更正与自助删除</strong
          >：可在应用内修改昵称、简介、时区、用户名与头像，删除单条运动记录、跑鞋、日记与照片，以及关闭公开主页或撤销独立分享链接。
        </li>
        <li>
          <strong>申请删除账号与数据</strong
          >：你可随时按下方「账号与数据删除申请」指引申请删除整个账号及关联数据，或申请删除特定类别的数据。
        </li>
        <li>
          <strong>撤销 Health Connect 权限</strong>：可随时在 Android 系统 Health Connect
          设置中撤销全部或单项只读权限；拒绝或撤销权限不影响 RunNote 其余核心功能。
        </li>
        <li>
          <strong>停用或不使用 AI 助手</strong>：AI
          助手仅在你主动提交消息时调用外部模型；你可以选择不使用该功能、删除历史对话，或通过邮件联系停用。
        </li>
        <li>
          <strong>清除本机数据</strong>：退出登录或在「设置 → 目标与隐私」点击“清除本地缓存”即可清除本机离线缓存。
        </li>
      </ul>
    </section>

    <section
      id="data-deletion"
      class="aux-panel settings-block deletion-section"
      aria-labelledby="data-deletion-title"
      data-testid="data-deletion-section"
    >
      <div class="block-title-row">
        <h2 id="data-deletion-title">账号与数据删除申请</h2>
        <span class="status-badge">邮件核验处理</span>
      </div>
      <p>
        RunNote 当前采用<strong>经身份核验的邮件申请流程</strong
        >处理账号及关联数据删除（暂不提供一键自助硬删），以防止账号被误删或遭他人恶意删除。
      </p>

      <div class="deletion-callout">
        <dl class="privacy-meta-grid">
          <div>
            <dt>收件邮箱</dt>
            <dd>
              <a class="privacy-link" href={DELETION_MAILTO} data-testid="deletion-email-link">{CONTACT_EMAIL}</a>
            </dd>
          </div>
          <div>
            <dt>发件邮箱要求</dt>
            <dd>请使用你注册 RunNote 账号时所用的邮箱发送</dd>
          </div>
          <div>
            <dt>建议邮件主题</dt>
            <dd><code>{DELETION_SUBJECT}</code></dd>
          </div>
        </dl>
        <div class="deletion-actions">
          <a class="button-primary" href={DELETION_MAILTO} data-testid="deletion-mailto-cta">发送账号删除请求邮件</a>
        </div>
      </div>

      <div class="privacy-subsection">
        <h3>申请时请说明与注意</h3>
        <ul class="privacy-list">
          <li>
            请在邮件正文中注明你的用户名（如有）以及申请范围：删除整个账号及全部关联数据，或保留账号但申请删除特定类别数据。
          </li>
          <li><strong>请勿在邮件中附带密码或其他敏感凭据。</strong></li>
          <li>
            <strong
              >请勿在公开的 GitHub Issue、讨论区或任何公开表单中提交账号删除请求或张贴个人邮箱、轨迹等私人信息。</strong
            >
          </li>
        </ul>
      </div>

      <div class="privacy-subsection">
        <h3>收到请求后的处理流程与说明</h3>
        <ol class="privacy-list privacy-steps">
          <li>
            <strong>身份核验</strong>：我们会核对发件邮箱是否与 RunNote
            账号记录一致，并在必要时通过该注册邮箱回复二次确认，以确保请求来自账号本人。
          </li>
          <li>
            <strong>账号与关联数据删除</strong
            >：核验通过后，我们会立即撤销该账号的全部登录会话，并从生产数据库中删除账号记录及全部关联服务端数据，包括个人资料与头像、运动记录与
            GPS 轨迹、跑步日记与照片、跑鞋与跑量目标、足迹与路线缓存、分享链接、AI
            助手对话记录以及（如有）身心健康记录。完成后会邮件回复确认（通常在完成身份核验后的 7
            个工作日内处理完毕；如遇特殊情况无法按期完成，也会通过邮件告知进度）。
          </li>
          <li>
            <strong>本机数据与系统权限</strong
            >：服务端删除不会远程清除你设备上已缓存的离线文件或系统权限。建议你在设备上退出登录或卸载应用以清除本机缓存与草稿，并按需在
            Android 系统的 Health Connect 设置中撤销只读权限。
          </li>
          <li>
            <strong>备份自然过期</strong
            >：生产数据库删除后，已删除数据可能仍留存于受限/加密的服务器备份与异地备份快照中，随自动轮转周期自然过期并被覆盖清除，期间不会重新启用或用于业务用途。
          </li>
          <li>
            <strong>安全与法律保留例外</strong
            >：如存在防范滥用、安全事件排查，或适用法律法规要求必须保留的极少记录（例如经哈希/脱敏的安全日志或用于证明已履行删除请求的必要邮件处理记录），我们仅在必要范围与期限内最小化保留，并在目的达成或法定期限届满后予以清除。
          </li>
        </ol>
      </div>
    </section>

    <section class="aux-panel settings-block" aria-labelledby="privacy-misc-title">
      <h2 id="privacy-misc-title">未成年人保护与政策变更</h2>
      <div class="privacy-subsection">
        <h3>未成年人</h3>
        <p>
          RunNote 不面向儿童（13
          周岁以下或所在地区适用法律规定的最低数字同意年龄以下人士）设计或提供服务，也不会在明知情况下收集儿童个人信息。如果你认为有儿童在未经适当同意的情况下向本服务提供了个人信息，请发送邮件至
          <a class="privacy-link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>，我们核实后将尽快删除。
        </p>
      </div>
      <div class="privacy-subsection">
        <h3>政策变更</h3>
        <p>
          随着功能迭代或数据处理实践变化，我们可能会适时更新本隐私政策。更新后的版本将发布在本页面，并同步更新顶部的生效日期。
        </p>
      </div>
    </section>
  </div>
</div>

<style>
  .privacy-page {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
  }
  .privacy-stack {
    max-width: 56rem;
    width: 100%;
  }
  .privacy-page section {
    scroll-margin-top: var(--space-6);
  }
  .privacy-page p,
  .privacy-list li {
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    overflow-wrap: anywhere;
  }
  .privacy-subsection {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .privacy-subsection h3 {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    color: var(--foreground);
  }
  .privacy-list {
    margin: 0;
    padding-inline-start: 1.25rem;
    display: grid;
    gap: var(--space-2);
    list-style: disc;
  }
  .privacy-steps {
    list-style: decimal;
  }
  .privacy-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .privacy-meta-grid dt {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .privacy-meta-grid dd {
    margin-top: var(--space-1);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    overflow-wrap: anywhere;
  }
  .privacy-link {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .deletion-section {
    border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
  }
  .deletion-callout {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--muted) 40%, var(--surface));
  }
  .deletion-callout .privacy-meta-grid {
    padding: 0;
    border: 0;
  }
  .deletion-callout code {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .deletion-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  @media (max-width: 639px) {
    .privacy-meta-grid {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }
  }
</style>
