export function publisherCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export function publisherDispatchEnabled(): boolean {
  return process.env.PUBLISHER_DISPATCH_ENABLED === "true";
}
