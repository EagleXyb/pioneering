import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:3000';

interface Profile {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  bio: string | null;
  company: string | null;
  position: string | null;
  joinDate: string;
  skills: string[];
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/profile`);
      if (!response.ok) {
        throw new Error('获取用户列表失败');
      }
      const data = await response.json();
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (user.company && user.company.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <div className="user-management">
      <style>{`
        .user-management {
          padding: 24px;
        }

        .user-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .user-title {
          font-size: 24px;
          font-weight: 600;
          color: #1f2937;
        }

        .user-subtitle {
          font-size: 14px;
          color: #6b7280;
          margin-top: 4px;
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .search-input {
          width: 280px;
          height: 40px;
          padding: 0 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 14px;
          background: white;
          transition: all 0.2s;
        }

        .search-input:focus {
          outline: none;
          border-color: #2490f8;
          box-shadow: 0 0 0 3px rgba(36, 144, 248, 0.1);
        }

        .refresh-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 14px;
          color: #374151;
          cursor: pointer;
          transition: all 0.2s;
        }

        .refresh-btn:hover {
          background: #e5e7eb;
        }

        .user-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 20px;
        }

        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: #1f2937;
        }

        .stat-label {
          font-size: 14px;
          color: #6b7280;
          margin-top: 4px;
        }

        .user-table-container {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
        }

        .user-table {
          width: 100%;
          border-collapse: collapse;
        }

        .user-table th {
          background: #f9fafb;
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid #e5e7eb;
        }

        .user-table td {
          padding: 16px;
          border-bottom: 1px solid #f3f4f6;
          font-size: 14px;
          color: #374151;
        }

        .user-table tr:last-child td {
          border-bottom: none;
        }

        .user-table tr:hover {
          background: #f9fafb;
        }

        .user-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
          background: #e5e7eb;
        }

        .user-avatar-placeholder {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2490f8, #7c3aed);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          font-size: 16px;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-name {
          font-weight: 500;
          color: #1f2937;
        }

        .user-email {
          font-size: 12px;
          color: #6b7280;
        }

        .skill-tag {
          display: inline-block;
          padding: 4px 8px;
          background: #eff6ff;
          color: #2490f8;
          border-radius: 4px;
          font-size: 12px;
          margin-right: 4px;
          margin-bottom: 4px;
        }

        .no-skills {
          color: #9ca3af;
          font-size: 12px;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-active {
          background: #dcfce7;
          color: #16a34a;
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px;
          color: #6b7280;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #e5e7eb;
          border-top-color: #2490f8;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-message {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 24px;
        }

        .empty-state {
          text-align: center;
          padding: 60px;
          color: #6b7280;
        }

        .empty-icon {
          width: 64px;
          height: 64px;
          margin: 0 auto 16px;
          color: #d1d5db;
        }
      `}</style>

      <div className="user-header">
        <div>
          <h1 className="user-title">用户管理</h1>
          <p className="user-subtitle">管理系统中的所有用户信息</p>
        </div>
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder="搜索用户名、邮箱或公司..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button className="refresh-btn" onClick={fetchUsers}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6"/>
              <path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            刷新
          </button>
        </div>
      </div>

      <div className="user-stats">
        <div className="stat-card">
          <div className="stat-value">{users.length}</div>
          <div className="stat-label">总用户数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{users.filter(u => u.company).length}</div>
          <div className="stat-label">已填写公司</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{users.filter(u => u.skills.length > 0).length}</div>
          <div className="stat-label">已填写技能</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{users.filter(u => u.avatar).length}</div>
          <div className="stat-label">已上传头像</div>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="user-table-container">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>加载中...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <h3>暂无用户数据</h3>
            <p>{searchTerm ? '没有找到匹配的用户' : '系统中还没有用户'}</p>
          </div>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>电话</th>
                <th>公司</th>
                <th>职位</th>
                <th>技能</th>
                <th>注册时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="user-info">
                      {user.avatar ? (
                        <img 
                          src={user.avatar} 
                          alt={user.name} 
                          className="user-avatar"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="user-avatar-placeholder">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="user-name">{user.name}</div>
                        <div className="user-email">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{user.phone || '-'}</td>
                  <td>{user.company || '-'}</td>
                  <td>{user.position || '-'}</td>
                  <td>
                    {user.skills.length > 0 ? (
                      user.skills.slice(0, 3).map((skill, index) => (
                        <span key={index} className="skill-tag">{skill}</span>
                      ))
                    ) : (
                      <span className="no-skills">暂无技能</span>
                    )}
                    {user.skills.length > 3 && (
                      <span className="skill-tag">+{user.skills.length - 3}</span>
                    )}
                  </td>
                  <td>{formatDate(user.joinDate)}</td>
                  <td>
                    <span className="status-badge status-active">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                        <circle cx="4" cy="4" r="4"/>
                      </svg>
                      活跃
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default UserManagement;
