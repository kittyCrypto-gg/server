  export function msUntilNextSunday(now = new Date()): number {
    const day = now.getDay(); // 0 = Sunday
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    let daysUntil = (7 - day) % 7;
    if (daysUntil === 0 && (hour > 0 || minute > 0 || second > 0)) daysUntil = 7;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntil);
    next.setHours(0, 0, 0, 0);
    return next.getTime() - now.getTime();
  }

