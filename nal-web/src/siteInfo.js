// 🏛️ 站点主体信息（合规页面统一读取这里）
// ⚠️ 上线前必须填写：LEGAL_ENTITY_NAME 必须与 Stripe 账户上的法定名称【完全一致】，
//    否则支付宝 / 微信支付审核会因"网站业务信息与 Stripe 资料不一致"被拒。

export const SITE_INFO = {
  BRAND_NAME: 'NewArtLiterature Collective（NAL 新艺文社）',
  BRAND_NAME_EN: 'NewArtLiterature Collective (NAL)',

  // ⚠️ 待填写：与 Stripe 账户一致的法定主体名称
  LEGAL_ENTITY_NAME: 'NewArtLiterature Collective',

  // ⚠️ 待填写：对外客服邮箱（同时填到 Stripe → Settings → Public details → Support email）
  CONTACT_EMAIL: 'info@nal-ai.org',

  BUSINESS_LOCATION: '加拿大安大略省',
  BUSINESS_LOCATION_EN: 'Ontario, Canada',

  // 适用法律（建议由律师确认）
  GOVERNING_LAW: '加拿大安大略省法律',
  GOVERNING_LAW_EN: 'the laws of the Province of Ontario, Canada',

  SITE_URL: 'https://www.nal-ai.org',
  LAST_UPDATED: '2026-11-08',
};
