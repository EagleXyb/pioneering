/**
 * 404 页面 — 路径未匹配时展示
 */
import { useNavigate } from 'react-router';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="not-found">
      <div className="not-found-code">404</div>
      <div className="not-found-text">页面不存在</div>
      <button className="not-found-btn" onClick={() => navigate('/chat', { replace: true })}>
        返回对话
      </button>
    </div>
  );
}
