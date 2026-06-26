const cron = require('node-cron');
const GluckRoomSession = require('../models/GluckRoomSession');
const gluckRoomService = require('../services/gluckRoomService');

async function autoStartSessions() {
  const now = new Date();

  const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);
  await GluckRoomSession.updateMany(
    { autoStartLockedAt: { $lt: staleThreshold } },
    { $set: { autoStartLockedAt: null } }
  );

  const windowEnd = new Date(now.getTime() + 5 * 60 * 1000);

  const candidates = await GluckRoomSession.find({
    status: 'scheduled',
    scheduledStartTime: { $gte: new Date(now.getTime() - 2 * 60 * 1000), $lte: windowEnd },
    autoStartLockedAt: null
  }).limit(20);

  for (const session of candidates) {
    const claimed = await GluckRoomSession.findOneAndUpdate(
      { _id: session._id, status: 'scheduled', autoStartLockedAt: null },
      { $set: { autoStartLockedAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;

    try {
      console.log(`Auto-starting GluckRoom session: "${claimed.sessionName}" (${claimed._id})`);

      await gluckRoomService.createRoom(claimed.livekitRoomName);

      claimed.status = 'active';
      claimed.actualStartTime = new Date();
      claimed.autoStartLockedAt = null;
      await claimed.save();

      console.log(`Auto-started GluckRoom session: "${claimed.sessionName}" (${claimed._id})`);
    } catch (err) {
      console.error(`Auto-start failed for session ${session._id}: ${err.message}`);
      await GluckRoomSession.findOneAndUpdate(
        { _id: session._id },
        { $set: { autoStartLockedAt: null } }
      );
    }
  }
}

async function autoEndEmptySessions() {
  const now = new Date();

  const activeSessions = await GluckRoomSession.find({ status: 'active' });

  for (const session of activeSessions) {
    try {
      if (now < new Date(session.scheduledStartTime.getTime() + 10 * 60 * 1000)) continue;
      let isEmpty = false;
      let roomGone = false;
      try {
        const participants = await gluckRoomService.getParticipants(session.livekitRoomName);
        isEmpty = participants.length === 0;
      } catch (err) {
        if (err.message?.includes('not found') || err.message?.includes('does not exist')) {
          isEmpty = true;
          roomGone = true;
        } else {
          throw err;
        }
      }

      if (isEmpty) {
        if (roomGone) {
          console.log(`Auto-ending GluckRoom session (room already deleted by LiveKit): "${session.sessionName}" (${session._id})`);
          session.status = 'ended';
          session.actualEndTime = new Date();
          session.emptiedAt = null;
          await session.save();
        } else if (!session.emptiedAt) {
          session.emptiedAt = new Date();
          await session.save();
        } else {
          const emptyDuration = now.getTime() - session.emptiedAt.getTime();
          if (emptyDuration >= 5 * 60 * 1000) {
            console.log(`Auto-ending empty GluckRoom session: "${session.sessionName}" (${session._id})`);
            await gluckRoomService.deleteRoom(session.livekitRoomName);
            session.status = 'ended';
            session.actualEndTime = new Date();
            session.emptiedAt = null;
            await session.save();
          }
        }
      } else {
        if (session.emptiedAt) {
          session.emptiedAt = null;
          await session.save();
        }
      }
    } catch (err) {
      console.error(`Auto-end check failed for session ${session._id}: ${err.message}`);
    }
  }
}

function scheduleGluckRoomAutoStart() {
  cron.schedule('* * * * *', () => {
    autoStartSessions().catch((err) =>
      console.error('[GluckRoom Auto-Start] Job error:', err.message)
    );
    autoEndEmptySessions().catch((err) =>
      console.error('[GluckRoom Auto-End] Job error:', err.message)
    );
  });
  console.log('GluckRoom auto-start & auto-end scheduled (every minute)');
}

module.exports = { scheduleGluckRoomAutoStart };
