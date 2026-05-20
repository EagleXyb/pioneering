declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.webp';
declare module '*.scss';
declare module '*.css';

declare function defineAppConfig(config: Record<string, any>): Record<string, any>;
declare function definePageConfig(config: Record<string, any>): Record<string, any>;

// TDesign 小程序组件类型声明
declare namespace JSX {
  interface IntrinsicElements {
    't-button': any;
    't-icon': any;
    't-input': any;
    't-textarea': any;
    't-avatar': any;
    't-badge': any;
    't-cell': any;
    't-cell-group': any;
    't-tag': any;
    't-loading': any;
    't-toast': any;
    't-dialog': any;
    't-popup': any;
    't-empty': any;
    't-steps': any;
    't-step': any;
    't-navbar': any;
    't-tabs': any;
    't-image': any;
    't-skeleton': any;
    't-divider': any;
    't-switch': any;
    't-message': any;
    't-drawer': any;
    't-swipe-cell': any;
    't-chat-message': any;
    't-chat-sender': any;
    't-chat-content': any;
    't-chat-actionbar': any;
    't-chat-list': any;
  }
}
