// Auth/User schemas —— 对应 Python app/schemas/user.py
import { z } from 'zod'

// 对应 Python: RegisterRequest
export const RegisterRequestSchema = z.object({
  username: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(128),
})
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>

// 对应 Python: LoginRequest
export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

// 对应 Python: RefreshTokenRequest
export const RefreshTokenRequestSchema = z.object({
  refresh_token: z.string(),
})
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>

// 对应 Python: TokenResponse
export const TokenResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  user: z.any().nullable().optional(),
})

// 对应 Python: UserProfile
export const UserProfileSchema = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// 对应 Python: UpdateProfileRequest
export const UpdateProfileRequestSchema = z.object({
  nickname: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
})
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>

// 对应 Python: UserListItem
export const UserListItemSchema = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  status: z.number(),
  totalTokens: z.number().default(0),
  usedTokens: z.number().default(0),
  dailyLimit: z.number().default(0),
  dailyUsed: z.number().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// 对应 Python: UserListResponse
export const UserListResponseSchema = z.object({
  list: z.array(UserListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

// 对应 Python: QuotaInfo
export const QuotaInfoSchema = z.object({
  totalTokens: z.number(),
  usedTokens: z.number(),
  dailyLimit: z.number(),
  dailyUsed: z.number(),
  resetAt: z.date().nullable().optional(),
})

// 对应 Python: UsageQuery
export const UsageQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(20),
})
