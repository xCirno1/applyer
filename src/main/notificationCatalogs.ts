import type { NotificationLocale, NotificationTestKind } from '@shared/types/notification'

interface NotificationMessage {
  title: string
  body: (jobTitle: string, company: string) => string
}

type NotificationCatalog = Record<NotificationTestKind, NotificationMessage> & {
  testJobTitle: string
  testCompany: string
}

export const NOTIFICATION_CATALOGS: Record<NotificationLocale, NotificationCatalog> = {
  en: {
    verificationRequired: {
      title: 'Verification required',
      body: (jobTitle, company) => `${jobTitle} at ${company} needs your attention in the browser window.`
    },
    permissionRequired: {
      title: 'Agent permission required',
      body: (jobTitle, company) => `The agent is waiting for permission to continue ${jobTitle} at ${company}.`
    },
    jobFilled: {
      title: 'Application ready for review',
      body: (jobTitle, company) => `${jobTitle} at ${company} has been filled and is ready for your review.`
    },
    jobFailed: {
      title: 'Job could not be completed',
      body: (jobTitle, company) => `${jobTitle} at ${company} failed. Open Applyer for details or to retry.`
    },
    testJobTitle: 'Test Job',
    testCompany: 'Example Company'
  },
  id: {
    verificationRequired: {
      title: 'Verifikasi diperlukan',
      body: (jobTitle, company) => `${jobTitle} di ${company} perlu perhatianmu di jendela browser.`
    },
    permissionRequired: {
      title: 'Izin agen diperlukan',
      body: (jobTitle, company) => `Agen menunggu izin untuk melanjutkan lamaran ${jobTitle} di ${company}.`
    },
    jobFilled: {
      title: 'Lamaran siap diperiksa',
      body: (jobTitle, company) => `${jobTitle} di ${company} sudah diisi dan siap kamu periksa.`
    },
    jobFailed: {
      title: 'Lowongan tidak dapat diselesaikan',
      body: (jobTitle, company) => `${jobTitle} di ${company} gagal. Buka Applyer untuk melihat detail atau mencoba lagi.`
    },
    testJobTitle: 'Lowongan Tes',
    testCompany: 'Perusahaan Contoh'
  }
}

export function notificationMessage(
  locale: NotificationLocale,
  kind: NotificationTestKind,
  jobTitle: string,
  company: string
): { title: string; body: string } {
  const message = NOTIFICATION_CATALOGS[locale][kind]
  return { title: message.title, body: message.body(jobTitle, company) }
}
