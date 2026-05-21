import React from 'react';
import tools from '../data/tools';

const HeroSection: React.FC = () => {
  return (
    <section className="trial-hero-section">
      <div className="trial-hero-content animate-in">
        <h2 className="trial-hero-title">Innovation and Creation</h2>
        <p className="trial-hero-subtitle">激发创新潜能，孵化未来梦想</p>
      </div>
    </section>
  );
};

const ToolsGrid: React.FC = () => {
  return (
    <section className="tools-section">
      <div className="tools-grid">
        {tools.map((tool) => (
          <div key={tool.id} className="tool-card">
            <div className="tool-icon">{tool.icon}</div>
            <h3 className="tool-name">{tool.title}</h3>
            <p className="tool-desc">{tool.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

const HomeContent: React.FC = () => {
  return (
    <div className="non-chat-content">
      <HeroSection />
      <ToolsGrid />
    </div>
  );
};

export { HeroSection, ToolsGrid };
export default HomeContent;
