// 用户管理模块 - TDesign Table + 后端分页

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Input,
  Button,
  Tag,
  Avatar,
  Alert,
  MessagePlugin,
} from 'tdesign-react';
import { SearchIcon, RefreshIcon } from 'tdesign-icons-react';
import type { PrimaryTableCol, PageInfo } from 'tdesign-react/es/table';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface UserListItem {
  id: string;
  username: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  status: number;
  totalTokens: number;
  usedTokens: number;
  dailyLimit: number;
  dailyUsed: number;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  list: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchUsers = useCallback(async (p?: number, ps?: number, search?: string) => {
    const currentPage = p ?? page;
    const currentPageSize = ps ?? pageSize;
    const currentSearch = search ?? searchTerm;
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(currentPageSize),
      });
      if (currentSearch) {
        params.set('search', currentSearch);
      }
      const response = await fetch(`${API_BASE_URL}/user/list?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('获取用户列表失败');
      }
      const result = await response.json();
      const payload: ListResponse = result.data || result;
      setUsers(payload.list || []);
      setTotal(payload.total || 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setError(msg);
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchTerm]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSearch = () => {
    setPage(1);
    fetchUsers(1, pageSize, searchTerm);
  };

  const handleRefresh = () => {
    setSearchTerm('');
    setPage(1);
    fetchUsers(1, pageSize, '');
  };

  const handlePageChange = (pageInfo: PageInfo) => {
    setPage(pageInfo.current);
    setPageSize(pageInfo.pageSize);
    fetchUsers(pageInfo.current, pageInfo.pageSize, searchTerm);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return String(tokens);
  };

  const columns: PrimaryTableCol<UserListItem>[] = [
    {
      colKey: 'user',
      title: '用户',
      width: 220,
      cell: ({ row }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Avatar size="40px">
            {row.avatar ? (
              <img
                src={row.avatar}
                alt={row.nickname || row.username}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              (row.nickname || row.username).charAt(0).toUpperCase()
            )}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, color: '#1f2937' }}>{row.nickname || row.username}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>{row.email || row.username}</div>
          </div>
        </div>
      ),
    },
    {
      colKey: 'phone',
      title: '电话',
      width: 140,
      cell: ({ row }) => row.phone || '-',
    },
    {
      colKey: 'quota',
      title: 'Token 用量',
      width: 140,
      cell: ({ row }) => (
        <div>
          <div style={{ fontSize: '13px' }}>
            {formatTokens(row.usedTokens)} / {formatTokens(row.totalTokens)}
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>
            日限 {formatTokens(row.dailyLimit)}
          </div>
        </div>
      ),
    },
    {
      colKey: 'createdAt',
      title: '注册时间',
      width: 120,
      cell: ({ row }) => formatDate(row.createdAt),
    },
    {
      colKey: 'status',
      title: '状态',
      width: 80,
      cell: ({ row }) => (
        <Tag theme={row.status === 1 ? 'success' : 'default'} variant="light" size="small">
          {row.status === 1 ? '活跃' : '禁用'}
        </Tag>
      ),
    },
  ];

  return (
    <div>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'rgba(0,0,0,0.9)', margin: 0 }}>用户管理</h1>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.4)', margin: '4px 0 0 0' }}>管理系统中的所有用户信息</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Input
            prefixIcon={<SearchIcon />}
            placeholder="搜索用户名、昵称或邮箱..."
            value={searchTerm}
            onChange={(val) => setSearchTerm(val as string)}
            clearable
            onEnter={handleSearch}
            style={{ width: 280 }}
          />
          <Button icon={<SearchIcon />} onClick={handleSearch}>
            搜索
          </Button>
          <Button icon={<RefreshIcon />} onClick={handleRefresh} variant="outline">
            刷新
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert theme="error" message={error} close onClose={() => setError(null)} style={{ marginBottom: 16 }} />
      )}

      {/* 用户表格 */}
      <Table
        data={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        empty="暂无用户数据"
        bordered
        stripe
        hover
        pagination={{
          current: page,
          pageSize,
          total,
          showJumper: true,
          showPageSize: true,
          pageSizeOptions: [10, 20, 50],
        }}
        onPageChange={handlePageChange}
      />
    </div>
  );
};

export default UserManagement;