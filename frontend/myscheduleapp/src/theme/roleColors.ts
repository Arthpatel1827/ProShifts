// src/theme/roleColors.ts
// One role → colour mapping for every schedule view, so "Kitchen" is the same colour
// everywhere. Each entry has a solid colour (bars, legend dots), a light fill and a dark
// text colour; text on the fill is ≥ 4.5:1 contrast (WCAG AA).

export type RoleColor = { solid: string; fill: string; text: string };

const PALETTE: RoleColor[] = [
    { solid: '#7B4AE2', fill: '#EFE8FC', text: '#4C2A9A' }, // violet (brand)
    { solid: '#0EA5E9', fill: '#E0F2FE', text: '#075985' }, // sky
    { solid: '#10B981', fill: '#D1FAE5', text: '#065F46' }, // emerald
    { solid: '#F59E0B', fill: '#FEF3C7', text: '#92400E' }, // amber
    { solid: '#F97316', fill: '#FFEDD5', text: '#9A3412' }, // orange (no red: it reads as an error)
    { solid: '#EC4899', fill: '#FCE7F3', text: '#9D174D' }, // pink
    { solid: '#14B8A6', fill: '#CCFBF1', text: '#115E59' }, // teal
    { solid: '#6366F1', fill: '#E0E7FF', text: '#3730A3' }, // indigo
];

// Common roles get a fixed colour; anything else gets a stable colour from its name.
const KNOWN: Record<string, number> = {
    owner: 7, manager: 0, supervisor: 1,
    cashier: 5, 'front counter': 5, barista: 6, server: 5, host: 5,
    kitchen: 3, cook: 3, chef: 3, prep: 3, 'line cook': 3,
    dishwasher: 2, cleaner: 2, delivery: 4, driver: 4,
};

const NEUTRAL: RoleColor = { solid: '#8A8A9A', fill: '#F3F4F6', text: '#374151' };

export function roleColor(role?: string | null): RoleColor {
    if (!role) return NEUTRAL;
    const key = role.trim().toLowerCase();
    if (key in KNOWN) return PALETTE[KNOWN[key]];
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}
