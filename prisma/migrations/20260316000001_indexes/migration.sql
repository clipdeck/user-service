-- prisma:disable-transactions
-- Performance indexes for user-service
-- Migration: 20260316000001_indexes

-- User: FK lookup — list all users referred by a specific user (referral program)
-- referredById is a self-referential FK with no index
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- Profile: filter profiles by role (admin dashboard, role-based user discovery)
CREATE INDEX "Profile_role_idx" ON "Profile"("role");

-- Profile: FK lookup — list profiles that were invited by a specific profile
-- invitedById is a FK with no index; needed for cascade deletes and referral trees
CREATE INDEX "Profile_invitedById_idx" ON "Profile"("invitedById");

-- Profile: paginated user listing sorted by creation date (admin user management)
CREATE INDEX "Profile_createdAt_idx" ON "Profile"("createdAt" DESC);
