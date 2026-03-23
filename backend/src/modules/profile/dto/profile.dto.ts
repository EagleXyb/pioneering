export class CreateProfileDto {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  bio?: string;
  company?: string;
  position?: string;
  skills?: string[];
  avatar?: string; // 头像base64编码
}

export class UpdateProfileDto {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  bio?: string;
  company?: string;
  position?: string;
  skills?: string[];
  avatar?: string; // 头像base64编码
}
