export function formatDisplayName(userId: string): string {
  if (!userId) return 'Unknown';
  const match = userId.match(/^@([^:]+)/);
  return match ? match[1] : userId;
}
