const cron = require('node-cron');
const Announcement = require('../models/Announcement');
const { dispatchWebsiteEmailAnnouncement } = require('../services/announcementEmailDispatch');

async function processPublishScheduledAnnouncements() {
  const now = new Date();
  const due = await Announcement.find({
    channel: 'website',
    isActive: false,
    scheduledPublishAt: { $exists: true, $lte: now }
  })
    .sort({ scheduledPublishAt: 1 })
    .limit(30)
    .lean();

  for (const row of due) {
    try {
      const fresh = await Announcement.findOne({
        _id: row._id,
        isActive: false,
        scheduledPublishAt: row.scheduledPublishAt
      }).lean();

      if (!fresh) continue;

      if (fresh.emailDispatch && fresh.emailDispatch.sentAt) {
        await Announcement.updateOne(
          { _id: fresh._id, isActive: false },
          { $set: { isActive: true, scheduledPublishAt: null } }
        );
        continue;
      }

      let emailDispatch = fresh.emailDispatch || {
        totalRecipients: 0,
        sentCount: 0,
        failedCount: 0,
        sentAt: null
      };

      if (fresh.deliveryType === 'website_email') {
        emailDispatch = await dispatchWebsiteEmailAnnouncement({
          targetBatches: fresh.targetBatches,
          title: fresh.title,
          body: fresh.body,
          emailSubject: fresh.emailSubject,
          emailBody: fresh.emailBody
        });
      }

      const result = await Announcement.updateOne(
        {
          _id: fresh._id,
          isActive: false,
          scheduledPublishAt: fresh.scheduledPublishAt
        },
        {
          $set: {
            isActive: true,
            scheduledPublishAt: null,
            emailDispatch
          }
        }
      );

      if (result.matchedCount) {
        console.log('[publishScheduledAnnouncements] published', String(fresh._id), fresh.title?.slice(0, 40));
      }
    } catch (err) {
      console.error('[publishScheduledAnnouncements] failed for', String(row._id), err.message || err);
    }
  }
}

function schedulePublishScheduledAnnouncements() {
  cron.schedule('* * * * *', () => {
    processPublishScheduledAnnouncements().catch((err) =>
      console.error('publishScheduledAnnouncements:', err.message || err)
    );
  });
  console.log('📅 Scheduled: publish due announcements (every minute)');
}

module.exports = { schedulePublishScheduledAnnouncements, processPublishScheduledAnnouncements };
