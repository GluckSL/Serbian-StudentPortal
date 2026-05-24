/**
 * Auto-start scheduled GluckRoom sessions when their scheduledStartTime arrives.
 * Runs every minute via node-cron.
 */
const cron = require('node-cron');
const GluckRoomSession = require('../models/GluckRoomSession');
const gluckRoomService = require('../services/gluckRoomService');
const User = require('../models/User');

async function autoStartSessions() {
  const now = new Date();

  // Release stale locks held longer than 5 minutes (crash recovery)
  const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);
  await GluckRoomSession.updateMany(
    { autoStartLockedAt: { $lt: staleThreshold } },
    { $set: { autoStartLockedAt: null } }
  );

  // Sessions scheduled between 3 minutes ago and now
  const windowStart = new Date(now.getTime() - 3 * 60 * 1000);

  const candidates = await GluckRoomSession.find({
    status: 'scheduled',
    scheduledStartTime: { $gte: windowStart, $lte: now },
    autoStartLockedAt: null
  }).limit(20);

  if (candidates.length === 0) return;

  for (const session of candidates) {
    // Atomic claim — prevent double-processing
    const claimed = await GluckRoomSession.findOneAndUpdate(
      { _id: session._id, status: 'scheduled', autoStartLockedAt: null },
      { $set: { autoStartLockedAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;

    try {
      console.log(`⏰ Auto-starting GluckRoom session: "${claimed.sessionName}" (${claimed._id})`);

      const { roomName, egressId } = await gluckRoomService.createRoomAndStartRecording(
        claimed.livekitRoomName,
        claimed.hostId.toString(),
        'camera'
      );

      claimed.livekitRoomName = roomName;
      claimed.egressId = egressId;
      claimed.status = 'active';
      claimed.actualStartTime = new Date();
      claimed.autoStartLockedAt = null;
      await claimed.save();

      console.log(`✅ Auto-started GluckRoom session: "${claimed.sessionName}" (${claimed._id})`);
    } catch (err) {
      console.error(`❌ Auto-start failed for session ${session._id}: ${err.message}`);
      // Release lock so next cron run can retry
      await GluckRoomSession.findOneAndUpdate(
        { _id: session._id },
        { $set: { autoStartLockedAt: null } }
      );
    }
  }
}

function scheduleGluckRoomAutoStart() {
  cron.schedule('* * * * *', () => {
    autoStartSessions().catch((err) =>
      console.error('❌ [GluckRoom Auto-Start] Job error:', err.message)
    );
  });
  console.log('⏰ GluckRoom auto-start scheduled (every minute)');
}

module.exports = { scheduleGluckRoomAutoStart };
