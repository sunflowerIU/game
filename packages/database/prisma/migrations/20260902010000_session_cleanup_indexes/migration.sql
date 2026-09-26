CREATE INDEX "GameSession_status_completedAt_idx" ON "GameSession"("status", "completedAt");
CREATE INDEX "AuthSession_revokedAt_idx" ON "AuthSession"("revokedAt");
