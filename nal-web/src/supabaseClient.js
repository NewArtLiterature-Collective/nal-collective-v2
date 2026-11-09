import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

// 在创建客户端【之前】记下网址 # 后的内容：Supabase 处理完邮件链接会把它清掉。
// 用于识别"重置密码"链接（type=recovery）以及链接过期的报错（error_code）。
export const INITIAL_URL_HASH = typeof window !== 'undefined' ? window.location.hash : ''
export const IS_RECOVERY_LINK = /(^|[#&])type=recovery(&|$)/.test(INITIAL_URL_HASH)

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage, // 👈 唯一改动
  }
})
