import React from 'react';
import { Settings, Bell } from 'lucide-react';

interface TopNavbarProps {
  title?: string;
}

const TopNavbar: React.FC<TopNavbarProps> = ({ title }) => {
  return (
    <header className="top-navbar">
      <div className="top-navbar-left">
        <span className="top-navbar-title">{title || 'IAC Incubator'}</span>
      </div>
      <div className="top-navbar-right">
        <button className="top-navbar-btn" title="通知">
          <Bell size={16} />
        </button>
        <button className="top-navbar-btn" title="设置">
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
};

export default TopNavbar;
