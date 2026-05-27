// DashboardOverview - 系统概览仪表盘

import React from 'react';
import { Card, Table, Button } from 'tdesign-react';
import {
  ArrowUpIcon,
  UserIcon,
  FileIcon,
} from 'tdesign-icons-react';

// ==================== 统计卡片数据 ====================
interface StatCardData {
  title: string;
  value: string;
  trend: number;
  trendLabel: string;
  type: 'primary' | 'default';
  iconType: 'trend' | 'bar' | 'user' | 'file';
}

const STAT_CARDS: StatCardData[] = [
  {
    title: '总收人',
    value: '¥28,425.00',
    trend: 29.5,
    trendLabel: '自从上周以来',
    type: 'primary',
    iconType: 'trend',
  },
  {
    title: '总退款',
    value: '¥768.00',
    trend: 20.5,
    trendLabel: '自从上周以来',
    type: 'default',
    iconType: 'bar',
  },
  {
    title: '活跃用户（个）',
    value: '1126',
    trend: 20.5,
    trendLabel: '自从上周以来',
    type: 'default',
    iconType: 'user',
  },
  {
    title: '订单（个）',
    value: '527',
    trend: 20.5,
    trendLabel: '自从上周以来',
    type: 'default',
    iconType: 'file',
  },
];

// ==================== 折线图数据 ====================
const LINE_DATA = [
  { date: '05-17', 本月: 62, 上月: 98 },
  { date: '05-18', 本月: 8, 上月: 15 },
  { date: '05-19', 本月: 35, 上月: 52 },
  { date: '05-20', 本月: 78, 上月: 80 },
  { date: '05-21', 本月: 70, 上月: 63 },
  { date: '05-22', 本月: 93, 上月: 95 },
  { date: '05-23', 本月: 28, 上月: 55 },
  { date: '05-24', 本月: 50, 上月: 45 },
  { date: '05-25', 本月: 40, 上月: 64 },
  { date: '05-26', 本月: 88, 上月: 61 },
];

// ==================== 表格数据 ====================
const SALES_ORDER_DATA = [
  { rank: 1, orderNo: 'ORD-20260526001', customer: '张三科技', amount: '¥12,500.00', status: '已完成', date: '2026-05-26' },
  { rank: 2, orderNo: 'ORD-20260525002', customer: '李四创新', amount: '¥9,800.00', status: '已完成', date: '2026-05-25' },
  { rank: 3, orderNo: 'ORD-20260524003', customer: '王五智能', amount: '¥8,200.00', status: '进行中', date: '2026-05-24' },
  { rank: 4, orderNo: 'ORD-20260523004', customer: '赵六数据', amount: '¥7,600.00', status: '已完成', date: '2026-05-23' },
  { rank: 5, orderNo: 'ORD-20260522005', customer: '孙七云服', amount: '¥6,300.00', status: '已完成', date: '2026-05-22' },
];

const PURCHASE_ORDER_DATA = [
  { rank: 1, orderNo: 'PUR-20260526001', supplier: 'AI算力供应商A', amount: '¥18,000.00', status: '已到货', date: '2026-05-26' },
  { rank: 2, orderNo: 'PUR-20260525002', supplier: '模型服务商B', amount: '¥15,500.00', status: '运输中', date: '2026-05-25' },
  { rank: 3, orderNo: 'PUR-20260524003', supplier: '知识库供应商C', amount: '¥12,800.00', status: '已到货', date: '2026-05-24' },
  { rank: 4, orderNo: 'PUR-20260523004', supplier: '组件平台D', amount: '¥10,200.00', status: '待发货', date: '2026-05-23' },
  { rank: 5, orderNo: 'PUR-20260522005', supplier: '存储服务E', amount: '¥8,900.00', status: '已到货', date: '2026-05-22' },
];

// ==================== 子组件 ====================

const StatCardIcon: React.FC<{ type: StatCardData['iconType']; isPrimary?: boolean }> = ({ type, isPrimary }) => {
  const color = isPrimary ? '#fff' : '#0052d9';
  const size = 32;
  switch (type) {
    case 'trend':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
          <path d="M8 34L18 22L26 30L38 16" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="38" cy="16" r="3" fill={color}/>
        </svg>
      );
    case 'bar':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
          <rect x="10" y="24" width="6" height="14" rx="1.5" fill={color} opacity="0.4"/>
          <rect x="19" y="16" width="6" height="22" rx="1.5" fill={color} opacity="0.7"/>
          <rect x="28" y="10" width="6" height="28" rx="1.5" fill={color}/>
        </svg>
      );
    case 'user':
      return <UserIcon size={size} style={{ color }} />;
    case 'file':
      return <FileIcon size={size} style={{ color }} />;
    default:
      return null;
  }
};

const StatCard: React.FC<StatCardData> = ({ title, value, trend, trendLabel, type, iconType }) => {
  const isPrimary = type === 'primary';
  const cardBg = isPrimary ? '#0052d9' : '#fff';
  const textColor = isPrimary ? '#fff' : 'rgba(0,0,0,0.9)';
  const subColor = isPrimary ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.45)';

  return (
    <div className={`stat-card ${isPrimary ? 'stat-card--primary' : ''}`}>
      <div className="stat-card__header">
        <span className="stat-card__title">{title}</span>
        <StatCardIcon type={iconType} isPrimary={isPrimary} />
      </div>
      <div className="stat-card__value" style={{ color: textColor }}>{value}</div>
      <div className="stat-card__footer">
        <span className="stat-card__label" style={{ color: subColor }}>{trendLabel}</span>
        <span className="stat-card__trend">
          <ArrowUpIcon size="14px" />
          <span>{trend}%</span>
        </span>
        <svg className="stat-card__arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4 2L8 6L4 10" stroke={subColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
};

const LineChartPanel: React.FC = () => {
  const maxVal = 100;
  const padding = { top: 20, right: 20, bottom: 36, left: 44 };
  const w = 700;
  const h = 280;
  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;

  const points1 = LINE_DATA.map((d, i) => ({
    x: padding.left + (i / (LINE_DATA.length - 1)) * innerW,
    y: padding.top + innerH - (d.本月 / maxVal) * innerH,
  }));
  const points2 = LINE_DATA.map((d, i) => ({
    x: padding.left + (i / (LINE_DATA.length - 1)) * innerW,
    y: padding.top + innerH - (d.上月 / maxVal) * innerH,
  }));

  const pathD1 = points1.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const pathD2 = points2.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const areaD1 = `${pathD1} L ${points1[points1.length - 1].x} ${padding.top + innerH} L ${points1[0].x} ${padding.top + innerH} Z`;
  const areaD2 = `${pathD2} L ${points2[points2.length - 1].x} ${padding.top + innerH} L ${points2[0].x} ${padding.top + innerH} Z`;

  return (
    <Card className="chart-card">
      <div className="chart-card__header">
        <h3 className="chart-card__title">统计数据</h3>
        <span className="chart-card__unit">（万元）</span>
        <div className="chart-card__date-range">
          <button className="date-btn">2026-05-20</button>
          <span className="date-sep">—</span>
          <button className="date-btn">2026-05-26</button>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 4 }}>
            <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="#999" strokeWidth="1.2"/>
            <line x1="4" y1="1" x2="4" y2="5" stroke="#999" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="10" y1="1" x2="10" y2="5" stroke="#999" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {/* Y轴刻度 */}
        {[0, 20, 40, 60, 80, 100].map(val => {
          const y = padding.top + innerH - (val / maxVal) * innerH;
          return (
            <g key={val}>
              <line x1={padding.left} y1={y} x2={w - padding.right} y2={y} stroke="#f0f0f0" strokeWidth="1"/>
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#999">{val}</text>
            </g>
          );
        })}

        {/* X轴日期 */}
        {LINE_DATA.map(d => {
          const i = LINE_DATA.indexOf(d);
          const x = padding.left + (i / (LINE_DATA.length - 1)) * innerW;
          return (
            <text key={d.date} x={x} y={h - 8} textAnchor="middle" fontSize="11" fill="#999">{d.date}</text>
          );
        })}

        {/* 上月面积 */}
        <path d={areaD2} fill="rgba(150,180,230,0.15)" />
        {/* 上月折线 */}
        <path d={pathD2} fill="none" stroke="#a0b8e0" strokeWidth="2" strokeLinejoin="round" />

        {/* 本月面积 */}
        <path d={areaD1} fill="rgba(0,82,217,0.08)" />
        {/* 本月折线 */}
        <path d={pathD1} fill="none" stroke="#0052d9" strokeWidth="2.2" strokeLinejoin="round" />

        {/* 本月数据点 */}
        {points1.map((p, i) => (
          <circle key={`p1-${i}`} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#0052d9" strokeWidth="2" />
        ))}
      </svg>

      {/* 图例 */}
      <div className="chart-legend">
        <span className="legend-item"><i className="legend-dot legend-dot--blue" />本月</span>
        <span className="legend-item"><i className="legend-dot legend-dot--gray" />上月</span>
      </div>
    </Card>
  );
};

const DonutChartPanel: React.FC = () => {
  const percentage = 78.09;
  const radius = 72;
  const cx = 120;
  const cy = 110;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <Card className="chart-card chart-card--donut">
      <div className="chart-card__header">
        <h3 className="chart-card__title">销售渠道</h3>
        <span className="chart-card__unit">2026-5元</span>
      </div>

      <div className="donut-wrapper">
        <svg width={cx * 2} height={cy * 2}>
          {/* 背景环 */}
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#e8ecf2" strokeWidth={strokeWidth} />
          {/* 进度环 */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#0052d9"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          {/* 中心文字 */}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="28" fontWeight="700" fill="#1a1a2e">{percentage}%</text>
          <text x={cx} y={cy + 20} textAnchor="middle" fontSize="12" fill="#999">线上渠道占比</text>
        </svg>
      </div>

      <div className="donut-legend">
        <span className="legend-item"><i className="legend-line legend-line--blue" />线上</span>
        <span className="legend-item"><i className="legend-line legend-line--gray" />门店</span>
      </div>
    </Card>
  );
};

const SalesOrderColumns = [
  { colKey: 'rank', title: '排名', width: 60 },
  { colKey: 'orderNo', title: '订单号', width: 160 },
  { colKey: 'customer', title: '客户名称' },
  { colKey: 'amount', title: '金额', width: 120 },
  { colKey: 'status', title: '状态', width: 90 },
  { colKey: 'date', title: '日期', width: 110 },
];

const PurchaseOrderColumns = [
  { colKey: 'rank', title: '排名', width: 60 },
  { colKey: 'orderNo', title: '采购单号', width: 160 },
  { colKey: 'supplier', title: '供应商' },
  { colKey: 'amount', title: '金额', width: 120 },
  { colKey: 'status', title: '状态', width: 90 },
  { colKey: 'date', title: '日期', width: 110 },
];

const RankingTable: React.FC<{
  title: string;
  data: Record<string, unknown>[];
  columns: { colKey: string; title: string; width?: number }[];
}> = ({ title, data, columns }) => {
  const [activeTab, setActiveTab] = React.useState<'month' | 'quarter'>('month');

  return (
    <Card className="table-card">
      <div className="table-card__header">
        <h3 className="table-card__title">{title}</h3>
        <div className="table-card__tabs">
          <Button
            variant={activeTab === 'month' ? 'base' : 'text'}
            theme="primary"
            size="small"
            onClick={() => setActiveTab('month')}
          >
            本月
          </Button>
          <Button
            variant={activeTab === 'quarter' ? 'base' : 'text'}
            theme="primary"
            size="small"
            onClick={() => setActiveTab('quarter')}
          >
            近三个月
          </Button>
        </div>
      </div>

      <Table
        data={data}
        columns={columns}
        size="small"
        bordered
        hover
        stripe
        rowKey="rank"
      />
    </Card>
  );
};

// ==================== 主组件 ====================
export const DashboardOverview: React.FC = () => {
  return (
    <div className="dashboard-overview">
      {/* Row 1: 统计卡片 */}
      <div className="dashboard-row dashboard-row--cards">
        {STAT_CARDS.map(card => (
          <StatCard key={card.title} {...card} />
        ))}
      </div>

      {/* Row 2: 图表区 */}
      <div className="dashboard-row dashboard-row--charts">
        <div className="chart-col chart-col--wide">
          <LineChartPanel />
        </div>
        <div className="chart-col chart-col--narrow">
          <DonutChartPanel />
        </div>
      </div>

      {/* Row 3: 排名表格 */}
      <div className="dashboard-row dashboard-row--tables">
        <RankingTable
          title="销售订单排名"
          data={SALES_ORDER_DATA}
          columns={SalesOrderColumns}
        />
        <RankingTable
          title="采购订单排名"
          data={PURCHASE_ORDER_DATA}
          columns={PurchaseOrderColumns}
        />
      </div>

      <style>{`
        .dashboard-overview {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .dashboard-row {
          display: grid;
          gap: 16px;
        }

        /* ===== 统计卡片行 ===== */
        .dashboard-row--cards {
          grid-template-columns: repeat(4, 1fr);
        }

        .stat-card {
          background: #fff;
          border-radius: 8px;
          padding: 20px 22px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          transition: box-shadow 0.2s ease;
          position: relative;
          overflow: hidden;
        }
        .stat-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .stat-card--primary {
          background: #0052d9;
        }

        .stat-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .stat-card__title {
          font-size: 13px;
          font-weight: 500;
          color: rgba(0,0,0,0.45);
        }
        .stat-card--primary .stat-card__title {
          color: rgba(255,255,255,0.85);
        }

        .stat-card__value {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 16px;
          letter-spacing: -0.5px;
        }

        .stat-card__footer {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
        }
        .stat-card__label {
          flex: 1;
        }
        .stat-card__trend {
          display: flex;
          align-items: center;
          gap: 3px;
          color: #00a870;
          font-weight: 600;
        }
        .stat-card--primary .stat-card__trend {
          color: #6dd3b8;
        }
        .stat-card__arrow {
          opacity: 0.6;
        }

        /* ===== 图表行 ===== */
        .dashboard-row--charts {
          grid-template-columns: 1.8fr 1fr;
        }

        .chart-card {
          border-radius: 8px;
          overflow: hidden;
        }
        .chart-card--donut {
          display: flex;
          flex-direction: column;
        }

        .chart-card__header {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 12px;
        }
        .chart-card__title {
          font-size: 15px;
          font-weight: 600;
          color: rgba(0,0,0,0.9);
          margin: 0;
        }
        .chart-card__unit {
          font-size: 12px;
          color: rgba(0,0,0,0.35);
        }

        .chart-card__date-range {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .date-btn {
          background: none;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12px;
          color: #666;
          cursor: pointer;
        }
        .date-sep {
          color: #ccc;
          font-size: 12px;
        }

        .chart-legend {
          display: flex;
          justify-content: center;
          gap: 24px;
          margin-top: 8px;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: rgba(0,0,0,0.6);
        }
        .legend-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .legend-dot--blue { background: #0052d9; }
        .legend-dot--gray { background: #a0b8e0; }
        .legend-line {
          display: inline-block;
          width: 16px;
          height: 3px;
          border-radius: 2px;
        }
        .legend-line--blue { background: #0052d9; }
        .legend-line--gray { background: #a0b8e0; }

        .donut-wrapper {
          display: flex;
          justify-content: center;
          padding: 16px 0 8px;
        }
        .donut-legend {
          display: flex;
          justify-content: center;
          gap: 24px;
          padding-bottom: 12px;
        }

        /* ===== 表格行 ===== */
        .dashboard-row--tables {
          grid-template-columns: 1fr 1fr;
        }

        .table-card {
          border-radius: 8px;
          overflow: hidden;
        }
        .table-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .table-card__title {
          font-size: 15px;
          font-weight: 600;
          color: rgba(0,0,0,0.9);
          margin: 0;
        }
        .table-card__tabs {
          display: flex;
          gap: 4px;
        }

        /* ===== 响应式 ===== */
        @media (max-width: 1200px) {
          .dashboard-row--cards {
            grid-template-columns: repeat(2, 1fr);
          }
          .dashboard-row--charts {
            grid-template-columns: 1fr;
          }
          .dashboard-row--tables {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .dashboard-row--cards {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default DashboardOverview;