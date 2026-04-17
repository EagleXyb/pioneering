export interface ProfileData {
  id?: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
  company: string;
  position: string;
  joinDate: string;
  skills: string[];
  achievements: { label: string; value: string }[];
  avatar?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
