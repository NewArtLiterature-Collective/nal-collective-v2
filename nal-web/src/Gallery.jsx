// nal-web/src/pages/Gallery.jsx 中的导航逻辑
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient'; // 假设你已配置好客户端

const Gallery = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    // 获取当前登录状态
    const session = supabase.auth.session();
    setUser(session?.user ?? null);
  }, []);

  // 动态处理返回/进入按钮
  const renderNavButtons = () => {
    if (user) {
      // 场景 A：用户已登录
      return (
        <button 
          onClick={() => navigate('/dashboard')} 
          className="text-stone-600 hover:text-indigo-600 transition-colors flex items-center"
        >
          <span className="mr-2">🏛️</span> 返回工作台 (Dashboard)
        </button>
      );
    } else {
      // 场景 B：访客身份
      return (
        <div className="flex gap-4">
          <button 
            onClick={() => navigate('/')} 
            className="text-stone-500 hover:text-stone-800"
          >
            ← 返回首页
          </button>
          <button 
            onClick={() => navigate('/login')} // 或者弹出登录框
            className="bg-stone-900 text-white px-4 py-1 text-sm rounded-sm hover:bg-stone-700"
          >
            登录/参与投稿
          </button>
        </div>
      );
    }
  };

  return (
    <header className="p-6 border-b flex justify-between items-center bg-stone-50">
      {renderNavButtons()}
      <h1 className="text-xl font-light tracking-widest">NAL EXHIBITION</h1>
      <div className="w-24"></div> {/* 占位平衡 */}
    </header>
  );
};

export default Gallery;
