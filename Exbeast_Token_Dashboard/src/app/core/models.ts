// Shapes returned by the backend (/api/token-owner). Every response is
// { status, message, data }.

export interface ApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export type Role = 'owner' | 'manager' | 'analyst';

export type Permission =
  | 'analytics.view'
  | 'profile.update'
  | 'requests.create'
  | 'team.view'
  | 'team.manage'
  | 'activity.view';

export interface Account {
  id: number;
  name: string;
  email: string;
  status: 'active' | 'suspended';
  google2fa_enabled: boolean;
  last_login_at: string | null;
}

export interface TokenRef {
  id: number;
  symbol: string;
  name: string;
  icon_url: string | null;
  status: string;
}

export interface Membership {
  token: TokenRef;
  role: Role;
  permissions: Permission[];
}

export interface AccountData {
  account: Account;
  tokens: Membership[];
}

export interface LoginData extends AccountData {
  token: string;
  expires_at: string;
}

/** Laravel paginate() */
export interface Page<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

/** Laravel simplePaginate(): no total, only next / previous. */
export interface SimplePage<T> {
  data: T[];
  current_page: number;
  per_page: number;
  next_page_url: string | null;
  prev_page_url: string | null;
}

export interface MarketRules {
  tick_size: string;
  lot_size: string;
  min_size: string;
  max_size: string;
  min_funds: string;
  price_band_bps: number;
}

export interface MarketStats {
  id: number;
  symbol: string;
  quote: string;
  status: string;
  rules: MarketRules;
  last_price: number | null;
  change_24h_pct: number | null;
  high_24h: number | null;
  low_24h: number | null;
  volume_24h: number;
  quote_volume_24h: number;
  trades_24h: number;
  engine: {
    reachable: boolean;
    last_price?: number | null;
    best_bid?: number | null;
    best_ask?: number | null;
    resting_orders?: { bids: number; asks: number };
  };
}

export interface Overview {
  token: TokenRef & { deposit_enabled: boolean; withdraw_enabled: boolean };
  summary: {
    volume_24h: number;
    quote_volume_24h_usdt: number;
    trades_24h: number;
    markets: number;
    markets_trading: number;
    trades_total: number;
    volume_total: number;
    quote_volume_total: number;
    holders: number;
    held_on_exchange: number;
  };
  markets: MarketStats[];
  generated_at: string;
}

export interface ChartDay {
  date: string;
  trades: number;
  volume: number;
  quote_volume: number;
  high: number | null;
  low: number | null;
}

export interface Trade {
  trade_id: string;
  symbol: string;
  side: 'buy' | 'sell' | null;
  price: string;
  size: string;
  funds: string;
  created_time: number;
}

export const SOCIAL_KEYS = [
  'twitter', 'telegram', 'discord', 'medium', 'github',
  'reddit', 'youtube', 'linkedin', 'facebook', 'instagram',
] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export interface TokenProfile {
  id: number;
  symbol: string;
  name: string;
  decimals: number;
  icon_url: string | null;
  description: string | null;
  website_url: string | null;
  whitepaper_url: string | null;
  explorer_url: string | null;
  social_links: Partial<Record<SocialKey, string>> | null;
  status: string;
  deposit_enabled: boolean;
  withdraw_enabled: boolean;
}

export type RequestType = 'market_settings' | 'market_status' | 'token_settings';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ChangeRequest {
  id: number;
  type: RequestType;
  status: RequestStatus;
  changes: Record<string, string | number | boolean>;
  previous: Record<string, string | number | boolean | null>;
  reason: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  market: { id: number; symbol: string } | null;
  requester: { id: number; name: string; email: string } | null;
}

export interface TeamMember {
  id: number;
  role: Role;
  permissions: Permission[];
  added_at: string;
  account: { id: number; name: string; email: string; status: string; last_login_at: string | null } | null;
}

export interface PendingInvite {
  id: number;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
}

export interface Team {
  members: TeamMember[];
  pending_invites: PendingInvite[];
  roles: Record<Role, Permission[]>;
}

export interface ActivityItem {
  id: number;
  action: string;
  description: string;
  by: { id?: number; name: string; email?: string };
  properties: Record<string, unknown>;
  created_at: string;
}
