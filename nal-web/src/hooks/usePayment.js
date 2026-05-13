import { useState } from 'react';
import { supabase } from '../supabaseClient';

export function usePayment() {
  const [payLoading, setPayLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(null);

  const handlePayment = async (planType) => {
    setPayLoading(true);
    setLoadingPlan(planType);
    try {
      const apiUrl = import.meta.env.VITE_API_BASE_URL;
      const { data: { session: authSession } } = await supabase.auth.getSession();
            
      if (!authSession?.user) return alert("请先登录");

      const response = await fetch(`${apiUrl}/api/v1/payment/create-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authSession.access_token}`
        },
        body: JSON.stringify({
          user_id: authSession.user.id,
          user_email: authSession.user.email,
          plan: planType 
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        // 这里拿到的就是后端返回的 {"detail": "您还有 X 次..."}
        const errorMsg = data.detail || "获取支付链接失败";
        alert(errorMsg); // 👈 这样用户就能看到具体的拦截原因了
        setPayLoading(false);
        return; // 🛑 终止，不执行后面的跳转
      }
      
      if (data.url) {
        window.location.href = data.url; 
      } else {
        throw new Error("未能获取支付链接");
      }
    } catch (err) {
      alert("支付网关连接失败: " + err.message);
    } finally {
      setPayLoading(false);
      setLoadingPlan(null);
    }
  };

  return { payLoading, loadingPlan, handlePayment };
}
