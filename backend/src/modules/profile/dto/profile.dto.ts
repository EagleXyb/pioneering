export class CreateProfileDto {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  bio?: string;
  company?: string;
  position?: string;
  skills?: string[];
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
}
