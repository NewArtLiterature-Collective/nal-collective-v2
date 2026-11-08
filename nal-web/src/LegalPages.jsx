// 📜 NAL 合规页面：服务与价格 / 服务条款 / 退款政策 / 隐私政策 / 比赛规则 / 联系我们
// 中英双语：支付宝、微信支付审核读中文，Stripe 审核读英文。
// 主体名称、客服邮箱等统一在 siteInfo.js 中维护。
import React from 'react';
import { Link } from 'react-router-dom';
import { SITE_INFO as S } from './siteInfo';

// ---------- 通用布局 ----------
export function LegalFooterLinks({ dark = false }) {
  const color = dark ? '#9ca3af' : '#6b7280';
  const links = [
    ['/pricing', '服务与价格 Pricing'],
    ['/terms', '服务条款 Terms'],
    ['/refund', '退款政策 Refunds'],
    ['/privacy', '隐私政策 Privacy'],
    ['/contest-rules', '比赛规则 Contest Rules'],
    ['/contact', '联系我们 Contact'],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', justifyContent: 'center', fontSize: '13px', marginTop: '12px' }}>
      {links.map(([to, label]) => (
        <Link key={to} to={to} style={{ color, textDecoration: 'none' }}>{label}</Link>
      ))}
    </div>
  );
}

function LegalLayout({ titleZh, titleEn, children }) {
  return (
    <div style={st.page}>
      <header style={st.header}>
        <Link to="/" style={st.brand}>NAL Collective</Link>
        <Link to="/" style={st.back}>← 返回首页 Home</Link>
      </header>
      <main style={st.main}>
        <h1 style={st.h1}>{titleZh}</h1>
        <div style={st.h1en}>{titleEn}</div>
        <div style={st.meta}>
          {S.LEGAL_ENTITY_NAME} · 最后更新 Last updated: {S.LAST_UPDATED}
        </div>
        {children}
      </main>
      <footer style={st.footer}>
        <div>© 2026 {S.BRAND_NAME_EN} · {S.LEGAL_ENTITY_NAME}</div>
        <LegalFooterLinks dark />
      </footer>
    </div>
  );
}

// 一个双语段落块：中文在上，英文在下
function Block({ zh, en, children }) {
  return (
    <section style={st.block}>
      <h2 style={st.h2}>{zh}</h2>
      {en && <div style={st.h2en}>{en}</div>}
      {children}
    </section>
  );
}
const Zh = ({ children }) => <div style={st.zh}>{children}</div>;
const En = ({ children }) => <div style={st.en}>{children}</div>;

// ---------- 服务与价格 ----------
const PLANS = [
  {
    zh: '免费用户', en: 'Free', price: '¥0',
    itemsZh: ['注册即赠送 3 次基础评审', '文档最大 50KB；每次最多 2 张图片（单张 1MB）', '可使用 2 个通用评审模型'],
    itemsEn: ['3 basic evaluations on sign-up', 'Documents up to 50KB; up to 2 images per evaluation (1MB each)', 'Access to 2 general evaluation models'],
  },
  {
    zh: '参赛报名', en: 'Competition Registration', price: '¥20 / 每届 per season',
    itemsZh: ['本届比赛作品提交资格（每个账号每届限投 1 件）', '高级评审 1 次', '文档最大 150KB；每次最多 5 张图片（单张 1.5MB）', '约 300 字高光片段示范', '仅在比赛报名开放期间可购买'],
    itemsEn: ['Eligibility to submit one entry to the current season (one entry per account per season)', '1 advanced evaluation', 'Documents up to 150KB; up to 5 images per evaluation (1.5MB each)', 'About 300 characters of sample passage writing', 'Available only while registration for the season is open'],
  },
  {
    zh: 'Pro 专业会员', en: 'Pro Membership', price: '¥500 / 年 per year',
    itemsZh: ['有效期 365 天，一次性付款，不自动续费', '全部评审功能及 7 个儿童文学学术评审模型', '比赛开放期间含参赛资格', '每天前 5 次评审使用旗舰模型，之后使用标准模型', '文档最大 10MB；每次最多 50 张图片（单张 10MB）', '约 800 字高光片段示范'],
    itemsEn: ['Valid for 365 days; one-time payment; does not auto-renew', 'All evaluation features and all 7 children\'s-literature evaluation models', 'Includes competition eligibility while a season is open', 'The first 5 evaluations each day use the flagship model; later evaluations use the standard model', 'Documents up to 10MB; up to 50 images per evaluation (10MB each)', 'About 800 characters of sample passage writing'],
  },
  {
    zh: '资源加油包', en: 'Credit Pack', price: '¥20 / 每份 per pack',
    itemsZh: ['基础评审 3 次 + 高级评审 2 次', '仅在现有评审次数全部用完后可购买', '不可退款'],
    itemsEn: ['3 basic evaluations + 2 advanced evaluations', 'Can be purchased only after all existing evaluations are used up', 'Non-refundable'],
  },
];

export function PricingPage() {
  return (
    <LegalLayout titleZh="服务与价格" titleEn="Services & Pricing">
      <Block zh="我们提供什么" en="What we offer">
        <Zh>{S.BRAND_NAME} 是一个儿童文学创作平台，提供 AI 辅助的稿件评审服务（文字、绘本、插画），并举办按专业评审标准评判的儿童文学写作比赛。</Zh>
        <En>{S.BRAND_NAME_EN} is a children's-literature platform offering AI-assisted manuscript evaluation (text, picture books and illustration) and children's-literature writing competitions judged against published criteria.</En>
      </Block>

      <div style={st.planGrid}>
        {PLANS.map(p => (
          <div key={p.en} style={st.planCard}>
            <div style={st.planName}>{p.zh}</div>
            <div style={st.planNameEn}>{p.en}</div>
            <div style={st.planPrice}>{p.price}</div>
            <ul style={st.ul}>{p.itemsZh.map(t => <li key={t}>{t}</li>)}</ul>
            <ul style={{ ...st.ul, ...st.enList }}>{p.itemsEn.map(t => <li key={t}>{t}</li>)}</ul>
          </div>
        ))}
      </div>

      <Block zh="价格与支付" en="Prices and payment">
        <Zh>所有价格以人民币（CNY）计价，含全部费用，无隐藏收费。支付由 Stripe 安全处理，我们不保存你的银行卡信息。使用外币银行卡时，汇率换算由发卡银行决定。</Zh>
        <En>All prices are in Chinese yuan (CNY) and include all fees; there are no hidden charges. Payments are processed securely by Stripe; we do not store your card details. If you pay with a card in another currency, your card issuer determines the exchange rate.</En>
      </Block>

      <Block zh="交付方式" en="Delivery">
        <Zh>所有服务均为线上数字服务，无实物配送。付款成功后，相应权益会自动发放到你的账户，通常在数秒内完成；评审报告在线即时生成并显示。如付款后 30 分钟内权益仍未到账，请联系 {S.CONTACT_EMAIL}。</Zh>
        <En>All services are delivered online as digital services; nothing is shipped. After a successful payment, the purchased entitlements are added to your account automatically, usually within seconds, and evaluation reports are generated and displayed online. If your entitlements have not appeared within 30 minutes of payment, contact {S.CONTACT_EMAIL}.</En>
      </Block>

      <Block zh="退款" en="Refunds">
        <Zh>参赛报名费与资源加油包不退款；Pro 会员开通 3 天内且未使用任何评审服务，可无理由全额退款。详见 <Link to="/refund">退款政策</Link>。</Zh>
        <En>Competition registration fees and credit packs are non-refundable. Pro Membership can be refunded in full within 3 days of activation if no evaluation service has been used. See the <Link to="/refund">Refund Policy</Link>.</En>
      </Block>
    </LegalLayout>
  );
}

// ---------- 退款政策 ----------
export function RefundPage() {
  return (
    <LegalLayout titleZh="退款政策" titleEn="Refund Policy">
      <Block zh="一、参赛报名费：不退款" en="1. Competition registration fee: non-refundable">
        <Zh>参赛报名费在付款成功后即开通本届参赛资格，不予退款。</Zh>
        <En>The competition registration fee unlocks eligibility for the current season as soon as payment succeeds and is non-refundable.</En>
      </Block>

      <Block zh="二、Pro 专业会员：3 天内未使用可全额退款" en="2. Pro Membership: full refund within 3 days if unused">
        <Zh>自 Pro 会员开通之时起 3 天（72 小时）内，如果你尚未使用任何评审服务，可无需说明理由，申请全额退款。</Zh>
        <Zh>“使用评审服务”包括：文字评审、绘本评审、插画评审、创作指导，以及以会员资格提交参赛作品。只要使用过其中任何一项，或已超过 3 天，即不予退款。</Zh>
        <Zh>退款完成后，Pro 会员权益同时终止。</Zh>
        <En>Within 3 days (72 hours) of activating Pro Membership, if you have not used any evaluation service, you may request a full refund without giving a reason.</En>
        <En>"Using an evaluation service" means any text, picture-book or illustration evaluation, any writing guidance, or submitting a competition entry under the membership. Once any of these has been used, or after 3 days, the membership is non-refundable.</En>
        <En>When the refund is completed, Pro Membership benefits end.</En>
      </Block>

      <Block zh="三、资源加油包：不退款" en="3. Credit packs: non-refundable">
        <Zh>资源加油包在付款成功后即发放评审次数，不予退款。</Zh>
        <En>Credit packs add evaluations to your account as soon as payment succeeds and are non-refundable.</En>
      </Block>

      <Block zh="四、重复扣款或权益未到账" en="4. Duplicate charges or missing entitlements">
        <Zh>如因系统原因发生重复扣款，或付款成功但权益未到账，我们核实后将为你补发权益或退还多扣款项。</Zh>
        <En>If you are charged twice because of a system error, or your payment succeeded but the entitlements did not arrive, we will verify the issue and either deliver the entitlements or refund the duplicate amount.</En>
      </Block>

      <Block zh="五、如何申请" en="5. How to request a refund">
        <Zh>请发送邮件至 {S.CONTACT_EMAIL}，注明注册邮箱、付款时间与金额。我们会在 2 个工作日内回复。符合条件的退款将原路退回到你的付款账户，到账时间取决于支付方式和发卡银行。</Zh>
        <En>Email {S.CONTACT_EMAIL} with your account email, the payment date and the amount. We reply within 2 business days. Approved refunds are returned to the original payment method; the time it takes to arrive depends on the payment method and your card issuer.</En>
      </Block>
    </LegalLayout>
  );
}

// ---------- 服务条款 ----------
export function TermsPage() {
  return (
    <LegalLayout titleZh="服务条款" titleEn="Terms of Service">
      <Block zh="1. 服务提供方" en="1. Who provides the service">
        <Zh>本网站（{S.SITE_URL}）及其服务由 {S.LEGAL_ENTITY_NAME}（以下称“我们”）运营，经营地为{S.BUSINESS_LOCATION}。使用本网站即表示你同意本条款。</Zh>
        <En>This website ({S.SITE_URL}) and its services are operated by {S.LEGAL_ENTITY_NAME} ("we"), based in {S.BUSINESS_LOCATION_EN}. By using the website you agree to these terms.</En>
      </Block>

      <Block zh="2. 服务内容" en="2. The service">
        <Zh>我们提供 AI 辅助的儿童文学稿件评审服务（文字、绘本、插画）、创作指导，并举办儿童文学写作比赛。各项服务的内容与价格见 <Link to="/pricing">服务与价格</Link>。</Zh>
        <En>We provide AI-assisted evaluation of children's-literature manuscripts (text, picture books and illustration), writing guidance, and children's-literature writing competitions. See <Link to="/pricing">Services & Pricing</Link> for what each service includes and costs.</En>
      </Block>

      <Block zh="3. 账户" en="3. Your account">
        <Zh>你应提供真实、准确的注册与报名信息，并妥善保管账户密码。一人一账户；以多个账户规避每届限投 1 件等规则的，我们可取消相关参赛资格。</Zh>
        <En>You must provide true and accurate registration information and keep your password secure. Each person may hold one account; we may cancel competition eligibility for anyone who uses multiple accounts to get around rules such as the one-entry-per-season limit.</En>
      </Block>

      <Block zh="4. 付款" en="4. Payment">
        <Zh>所有付费项目均为一次性付款，以人民币计价，不自动续费。退款按 <Link to="/refund">退款政策</Link> 处理。</Zh>
        <En>All paid items are one-time payments in CNY and do not auto-renew. Refunds are handled under the <Link to="/refund">Refund Policy</Link>.</En>
      </Block>

      <Block zh="5. AI 评审的性质" en="5. Nature of AI evaluations">
        <Zh>评审报告由 AI 模型（包括第三方模型服务）生成，仅供创作参考，不代表获奖、出版或任何商业结果的承诺。</Zh>
        <En>Evaluation reports are generated by AI models, including third-party model services. They are for creative reference only and are not a promise of any award, publication or commercial outcome.</En>
      </Block>

      <Block zh="6. 比赛" en="6. Competitions">
        <Zh>比赛是凭作品质量评判的写作比赛，依据公开的评审标准进行，不含任何抽签、随机抽选或抽奖成分。参赛资格、投稿规则与评审方式见 <Link to="/contest-rules">比赛规则</Link>；各届主题、截稿日期与奖项以首页公布的当届章程为准。</Zh>
        <En>Our competitions are writing competitions decided on the quality of the work, judged against published criteria, with no element of drawing lots, random selection or lottery. See the <Link to="/contest-rules">Competition Rules</Link> for eligibility, submission rules and judging; each season's theme, deadline and awards are as announced on the home page.</En>
      </Block>

      <Block zh="7. 原创与 AI 辅助声明" en="7. Originality and AI-assistance declaration">
        <Zh>提交的作品应为你本人创作。提交评审或参赛时，须如实声明是否使用了 AI 工具辅助。声明为纯人类原创、但经检测与事实不符的，该次评审将终止（不扣除次数），参赛作品可能被取消资格。</Zh>
        <En>Work you submit must be your own. When submitting for evaluation or to a competition, you must truthfully declare whether AI tools assisted you. If a work declared as entirely human-made is found otherwise, that evaluation is stopped (no evaluation is deducted) and a competition entry may be disqualified.</En>
      </Block>

      <Block zh="8. 你的作品与知识产权" en="8. Your work and intellectual property">
        <Zh>你保留所提交作品的全部著作权。你授权我们为提供评审、比赛评审与管理之目的处理你的作品；比赛中入选展出的作品，你授权我们在线上展厅中署名展示。我们不会出售你的作品。</Zh>
        <En>You keep all copyright in the work you submit. You allow us to process your work to provide evaluations and to run and judge competitions, and you allow us to display competition works selected for exhibition, with attribution, in our online gallery. We do not sell your work.</En>
      </Block>

      <Block zh="9. 禁止内容" en="9. Prohibited content">
        <Zh>禁止提交色情内容、任何对未成年人的性化内容、违法内容或侵犯他人权利的内容。违反者我们可终止相关评审、取消参赛资格，且不予退款。</Zh>
        <En>You may not submit sexual content, any sexualised depiction of minors, unlawful content, or content that infringes the rights of others. We may stop the evaluation, disqualify the entry and refuse a refund for any breach.</En>
      </Block>

      <Block zh="10. 服务变更与终止" en="10. Changes and termination">
        <Zh>我们可能调整或改进服务。对于严重违反本条款的账户，我们可暂停或终止服务。</Zh>
        <En>We may change or improve the service. We may suspend or terminate accounts that seriously breach these terms.</En>
      </Block>

      <Block zh="11. 责任限制" en="11. Limitation of liability">
        <Zh>在法律允许的范围内，我们对任何间接损失不承担责任，对你的全部责任以你在此前 12 个月内向我们支付的金额为限。</Zh>
        <En>To the extent permitted by law, we are not liable for indirect losses, and our total liability to you is limited to the amount you paid us in the preceding 12 months.</En>
      </Block>

      <Block zh="12. 适用法律与联系" en="12. Governing law and contact">
        <Zh>本条款适用{S.GOVERNING_LAW}。如有疑问，请联系 {S.CONTACT_EMAIL}。</Zh>
        <En>These terms are governed by {S.GOVERNING_LAW_EN}. Questions: {S.CONTACT_EMAIL}.</En>
      </Block>
    </LegalLayout>
  );
}

// ---------- 隐私政策 ----------
export function PrivacyPage() {
  return (
    <LegalLayout titleZh="隐私政策" titleEn="Privacy Policy">
      <Block zh="我们收集哪些信息" en="What we collect">
        <Zh>账户信息：电子邮箱；密码由认证服务商加密保存，我们无法看到。报名信息：姓名、手机号、性别。你提交的作品：文本与图片。使用记录：评审次数与额度。支付由 Stripe 处理，我们不接触、不保存银行卡号。</Zh>
        <En>Account details: your email address; your password is stored in encrypted form by our authentication provider and we cannot see it. Registration details: name, phone number and gender. The work you submit: text and images. Usage records: evaluations used and remaining. Payments are processed by Stripe; we never see or store card numbers.</En>
      </Block>

      <Block zh="我们如何使用" en="How we use it">
        <Zh>用于提供评审与创作指导、组织与评审比赛（包括用手机号防止一人多号参赛）、计费以及回复你的咨询。我们不会出售你的个人信息。</Zh>
        <En>To provide evaluations and writing guidance, to run and judge competitions (including using phone numbers to prevent one person entering under several accounts), for billing, and to answer your questions. We do not sell your personal information.</En>
      </Block>

      <Block zh="与谁共享" en="Who we share it with">
        <Zh>仅与提供服务所必需的服务商共享：Supabase（账户与数据存储）、Google Gemini（你的作品文本与图片会发送至其接口以生成评审报告）、Stripe（支付）、Render 与 Cloudflare（网站托管与网络）。</Zh>
        <En>Only with the providers we need to run the service: Supabase (accounts and data storage), Google Gemini (the text and images of your work are sent to its API to generate evaluation reports), Stripe (payments), and Render and Cloudflare (hosting and networking).</En>
      </Block>

      <Block zh="浏览器存储" en="Browser storage">
        <Zh>我们仅在浏览器的会话存储中保存登录状态，关闭浏览器后即清除；不使用广告追踪。</Zh>
        <En>We keep your sign-in state in your browser's session storage only, which is cleared when you close the browser. We do not use advertising trackers.</En>
      </Block>

      <Block zh="你的权利" en="Your rights">
        <Zh>你可以联系 {S.CONTACT_EMAIL}，申请查阅、更正或删除你的个人信息。</Zh>
        <En>You can contact {S.CONTACT_EMAIL} to access, correct or delete your personal information.</En>
      </Block>

      <Block zh="未成年人" en="Minors">
        <Zh>未满 18 周岁者应在父母或监护人同意下使用本服务。</Zh>
        <En>Anyone under 18 should use the service only with the consent of a parent or guardian.</En>
      </Block>

      <Block zh="政策更新" en="Changes">
        <Zh>政策如有更新，我们会在本页公布并更新日期。</Zh>
        <En>If this policy changes, we will post the update on this page and change the date above.</En>
      </Block>
    </LegalLayout>
  );
}

// ---------- 比赛规则 ----------
export function ContestRulesPage() {
  return (
    <LegalLayout titleZh="比赛规则与评审说明" titleEn="Competition Rules & Judging">
      <Block zh="参赛资格" en="Eligibility">
        <Zh>注册账号并完成本届参赛报名，或持有有效的 Pro 会员，即可在报名开放期间参赛。</Zh>
        <En>Anyone with an account who has registered for the current season, or who holds an active Pro Membership, may enter while registration is open.</En>
      </Block>

      <Block zh="投稿规则" en="Submission rules">
        <Zh>每个账号每届限投 1 件作品。截稿时间过后投稿通道关闭。作品须为本人创作，并如实声明是否使用 AI 辅助。因内容违规或虚假声明被取消资格的作品，本届不可重新投稿。</Zh>
        <En>Each account may submit one entry per season. Submissions close at the deadline. Entries must be your own work, with a truthful declaration of any AI assistance. An entry disqualified for prohibited content or a false declaration cannot be resubmitted that season.</En>
      </Block>

      <Block zh="评审方式" en="How entries are judged">
        <Zh>依据公开的评审标准，先由多个儿童文学学术评审模型进行初评，再由编辑团队复核与策展。结果完全取决于作品质量，不含任何抽签、随机抽选或抽奖成分。</Zh>
        <En>Entries are first assessed against the published criteria by several children's-literature evaluation models, then reviewed and curated by our editorial team. Results depend entirely on the quality of the work; there is no drawing of lots, random selection or lottery.</En>
      </Block>

      <Block zh="结果与展示" en="Results and exhibition">
        <Zh>入选作品可能在线上展厅中署名展出。各届的主题、截稿日期与奖项设置，以首页公布的当届章程为准。</Zh>
        <En>Selected works may be exhibited, with attribution, in our online gallery. Each season's theme, deadline and awards are as set out in that season's announcement on the home page.</En>
      </Block>
    </LegalLayout>
  );
}

// ---------- 联系我们 ----------
export function ContactPage() {
  return (
    <LegalLayout titleZh="联系我们" titleEn="Contact Us">
      <Block zh="运营主体" en="Operator">
        <Zh>{S.LEGAL_ENTITY_NAME}（{S.BRAND_NAME}）</Zh>
        <En>{S.LEGAL_ENTITY_NAME} ({S.BRAND_NAME_EN})</En>
        <Zh>经营地：{S.BUSINESS_LOCATION}</Zh>
        <En>Location: {S.BUSINESS_LOCATION_EN}</En>
      </Block>
      <Block zh="客服邮箱" en="Support email">
        <Zh><a href={`mailto:${S.CONTACT_EMAIL}`} style={st.link}>{S.CONTACT_EMAIL}</a></Zh>
        <Zh>我们会在 2 个工作日内回复。申请退款时，请注明注册邮箱、付款时间与金额。</Zh>
        <En>We reply within 2 business days. For refund requests, include your account email, the payment date and the amount.</En>
      </Block>
    </LegalLayout>
  );
}

// ---------- 样式 ----------
const st = {
  page: { fontFamily: 'system-ui, sans-serif', color: '#111827', background: '#f9fafb', minHeight: '100vh', display: 'flex', flexDirection: 'column', textAlign: 'left' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: '20px', fontWeight: 'bold', color: '#4f46e5', textDecoration: 'none' },
  back: { fontSize: '14px', color: '#4b5563', textDecoration: 'none' },
  main: { maxWidth: '860px', width: '100%', margin: '0 auto', padding: '40px 16px 60px', boxSizing: 'border-box', flex: 1 },
  h1: { fontSize: '32px', margin: 0 },
  h1en: { fontSize: '18px', color: '#6b7280', marginTop: '4px' },
  meta: { fontSize: '13px', color: '#9ca3af', margin: '12px 0 28px' },
  block: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px 22px', marginBottom: '16px' },
  h2: { fontSize: '18px', margin: '0 0 2px' },
  h2en: { fontSize: '14px', color: '#6b7280', marginBottom: '10px' },
  zh: { fontSize: '15px', lineHeight: 1.8, marginTop: '6px' },
  en: { fontSize: '14px', lineHeight: 1.7, color: '#4b5563', marginTop: '6px' },
  link: { color: '#4f46e5' },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '16px' },
  planCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px' },
  planName: { fontSize: '18px', fontWeight: 'bold' },
  planNameEn: { fontSize: '13px', color: '#6b7280' },
  planPrice: { fontSize: '22px', fontWeight: 800, color: '#4f46e5', margin: '10px 0' },
  ul: { paddingLeft: '18px', margin: '8px 0', fontSize: '14px', lineHeight: 1.7 },
  enList: { color: '#6b7280', fontSize: '13px' },
  footer: { textAlign: 'center', padding: '28px 16px', background: '#111827', color: '#9ca3af', fontSize: '13px' },
};
