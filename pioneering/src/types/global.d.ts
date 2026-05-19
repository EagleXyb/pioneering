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
