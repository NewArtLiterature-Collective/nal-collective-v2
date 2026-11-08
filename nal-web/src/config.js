// 🌐 NAL 前端统一环境配置出口
// 所有后端地址与 Supabase 凭据都来自【构建期环境变量】，不再硬编码在源码里。
// 这样每个前端 build 各自指向自己的后端与数据库：
//   - v2（调试）：指向调试后端 + 调试 Supabase
//   - www（生产）：指向生产后端 + nal-ai-project 生产库
// 关键变量缺失时立即抛错，避免某个 build（尤其是 www）悄悄连到错误的后端/数据库。
//
// ⚠️ 这三个变量必须在【每个前端部署各自的构建环境变量】里设置
//    （Render → 对应前端服务 → Environment）。生产服务务必设成生产值，
//    覆盖仓库里 .env 文件中的开发默认值。

function need(value, name) {
  if (!value) {
    throw new Error(
      `[NAL 配置缺失] 环境变量 ${name} 未设置。请在该前端部署的构建环境变量中配置它（Render → 该前端服务 → Environment）。`
    );
  }
  return value;
}

// 静态引用（Vite 在构建期静态替换 import.meta.env.VITE_*）
export const API_BASE = need(import.meta.env.VITE_API_BASE_URL, 'VITE_API_BASE_URL');
export const SUPABASE_URL = need(import.meta.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = need(import.meta.env.VITE_SUPABASE_ANON_KEY, 'VITE_SUPABASE_ANON_KEY');
