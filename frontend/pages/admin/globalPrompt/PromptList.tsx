// Prompt 列表页面 - 使用 TDesign 组件

import React, { useState } from 'react';
import {
  Table,
  Button,
  Loading,
  Alert,
  DialogPlugin,
} from 'tdesign-react';
import { EditIcon, BrowseIcon, DeleteIcon } from 'tdesign-icons-react';
import type { PrimaryTableCol, TableSort } from 'tdesign-react/es/table';
import { useGlobalPrompt } from './useGlobalPrompt';
import type { PromptListProps, GlobalPrompt } from './types';

export const PromptList: React.FC<PromptListProps> = ({
  onEdit,
  onView,
}) => {
  const {
    prompts,
    loading,
    error,
    fetchPrompts,
    handleDelete: apiHandleDelete,
  } = useGlobalPrompt();

  const [sort, setSort] = useState<TableSort>();

  // 处理删除操作
  const handleDelete = (id: number) => {
    DialogPlugin.confirm({
      header: '确认删除',
      body: '确定要删除此Prompt吗？',
      confirmBtn: '确定',
      cancelBtn: '取消',
      onConfirm: async () => {
        try {
          await apiHandleDelete(id);
        } catch {
          // error handled in hook
        }
      },
    });
  };

  // 处理重试
  const handleRetry = () => {
    fetchPrompts();
  };

  if (loading) {
    return <Loading text="加载中..." style={{ padding: '60px 0' }} />;
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Alert theme="error" message={error} style={{ marginBottom: '16px' }} />
        <Button theme="primary" onClick={handleRetry}>重试</Button>
      </div>
    );
  }

  const columns: PrimaryTableCol<GlobalPrompt>[] = [
    {
      colKey: 'id',
      title: 'Prompt Key',
      width: 100,
    },
    {
      colKey: 'name',
      title: 'Prompt 名称',
      width: 160,
    },
    {
      colKey: 'templateContent',
      title: 'Prompt 描述',
      ellipsis: true,
      cell: ({ row }) => row.templateContent?.substring(0, 50) + '...',
    },
    {
      colKey: 'version',
      title: '最新版本',
      width: 100,
      cell: ({ row }) => `v${row.version}`,
    },
    {
      colKey: 'createdBy',
      title: '提交人',
      width: 100,
    },
    {
      colKey: 'updatedAt',
      title: '提交时间',
      width: 180,
      sorter: true,
      cell: ({ row }) => new Date(row.updatedAt).toLocaleString(),
    },
    {
      colKey: 'creator',
      title: '创建人',
      width: 100,
      cell: ({ row }) => row.createdBy,
    },
    {
      colKey: 'createdAt',
      title: '创建时间',
      width: 180,
      sorter: true,
      cell: ({ row }) => new Date(row.createdAt).toLocaleString(),
    },
    {
      colKey: 'remark',
      title: '备注',
      width: 80,
      cell: () => '-',
    },
    {
      colKey: 'actions',
      title: '操作',
      width: 140,
      fixed: 'right',
      cell: ({ row }) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<BrowseIcon />}
            onClick={() => onView(row)}
          />
          <Button
            theme="primary"
            variant="text"
            size="small"
            icon={<EditIcon />}
            onClick={() => onEdit(row)}
          />
          <Button
            theme="danger"
            variant="text"
            size="small"
            icon={<DeleteIcon />}
            onClick={() => handleDelete(row.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="prompt-list">
      <div className="form-card">
        <Table
          data={prompts}
          columns={columns}
          rowKey="id"
          sort={sort}
          onSortChange={(sortVal) => setSort(sortVal as TableSort)}
          empty="暂无内容"
          bordered
          stripe
          hover
          maxHeight={600}
        />
      </div>
    </div>
  );
};