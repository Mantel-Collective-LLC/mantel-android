export const LAN_V4 = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "224.0.0.0/4",
  "255.255.255.255/32",
] as const;

export const ROUTE_EXCLUDE_V4 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "224.0.0.0/3"] as const;

export const LAN_V6 = ["fc00::/7", "fe80::/10", "ff00::/8"] as const;

export const NON_UNICAST = ["224.0.0.0/4", "255.255.255.255/32", "ff00::/8"] as const;

export const LOOPBACK = ["127.0.0.0/8", "::1/128"] as const;

export const FULL_TUNNEL = ["0.0.0.0/0", "::/0"] as const;

export const SPLIT_DEFAULT = ["0.0.0.0/1", "128.0.0.0/1", "::/1", "8000::/1"] as const;

export const DHCP_SERVER_PORTS = [67, 547] as const;

export const DNS_PORT = 53;
