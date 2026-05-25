declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.webp';
declare module '*.scss';
declare module '*.css';

declare const process: {
  env: Record<string, string | undefined>;
};

declare function defineAppConfig(config: Record<string, any>): Record<string, any>;
declare function definePageConfig(config: Record<string, any>): Record<string, any>;

// TDesign 小程序组件类型声明（仅包含 app.config.ts 中已注册的组件）
declare namespace JSX {
  interface IntrinsicElements {
    't-button': any;
    't-drawer': any;
    't-skeleton': any;
    't-toast': any;
    't-popup': any;
    't-icon': any;
    't-overlay': any;
    't-image': any;
    't-loading': any;
    't-navbar': any;
    'attachments': any;
    't-chat-message': any;
    't-chat-content': any;
  }
}
