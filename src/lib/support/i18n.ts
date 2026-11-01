import { SUPPORT_LOCALES, type SupportLocale } from './constants'

export type SupportStrings = {
  title: string
  subtitle: string
  online: string
  offline: string
  open: string
  close: string
  loading: string
  start: string
  welcome: string
  placeholder: string
  send: string
  quickTitle: string
  quickQuestions: string[]
  offlineNotice: string
  connecting: string
  reconnecting: string
  connectionError: string
  retry: string
  sending: string
  failed: string
  retrySend: string
  delivered: string
  read: string
  typing: string
  closedNotice: string
  reopen: string
  privacy: string
  empty: string
  messageTooLong: string
  rateLimited: string
  csatTitle: string
  csatComment: string
  csatSubmit: string
  csatSkip: string
  csatThanks: string
  fallback: string
  unread: string
}

const STRINGS: Record<SupportLocale, SupportStrings> = {
  zh: {
    title: '在线客服',
    subtitle: '通常几分钟内回复',
    online: '在线',
    offline: '离线',
    open: '打开客服',
    close: '关闭',
    loading: '正在连接…',
    start: '开始对话',
    welcome: '你好，请直接描述问题；如果是上传、审片或账号问题，附上页面路径会更快定位。',
    placeholder: '输入消息，Enter 发送',
    send: '发送',
    quickTitle: '常见问题',
    quickQuestions: ['如何上传视频？', '如何分享审片链接？', '价格和套餐怎么选？'],
    offlineNotice: '当前不在线，留言会在下一个工作日回复。',
    connecting: '正在连接客服…',
    reconnecting: '连接断开，正在重连…',
    connectionError: '暂时连不上客服，请稍后重试或使用微信/邮件联系。',
    retry: '重试',
    sending: '发送中',
    failed: '发送失败',
    retrySend: '重发',
    delivered: '已送达',
    read: '已读',
    typing: '对方正在输入…',
    closedNotice: '这段对话已结束，发送新消息会重新打开。',
    reopen: '重新打开',
    privacy: '对话会保存用于回复与改进服务；请勿发送密码、验证码等敏感信息。',
    empty: '还没有消息，先打个招呼吧。',
    messageTooLong: '消息太长，请精简后重发。',
    rateLimited: '发送太频繁，请稍后再试。',
    csatTitle: '这次服务怎么样？',
    csatComment: '可以补充一句（可选）',
    csatSubmit: '提交评价',
    csatSkip: '跳过',
    csatThanks: '谢谢你的反馈。',
    fallback: '其他联系方式',
    unread: '未读',
  },
  en: {
    title: 'Live support',
    subtitle: 'We usually reply within minutes',
    online: 'Online',
    offline: 'Offline',
    open: 'Open support',
    close: 'Close',
    loading: 'Connecting…',
    start: 'Start chat',
    welcome: 'Hi — tell us what you need. For upload, review or account issues, include the page path so we can find it faster.',
    placeholder: 'Write a message, Enter to send',
    send: 'Send',
    quickTitle: 'Quick questions',
    quickQuestions: ['How do I upload a video?', 'How do I share a review link?', 'Which plan should I choose?'],
    offlineNotice: 'We are offline. Your message will be answered on the next business day.',
    connecting: 'Connecting to support…',
    reconnecting: 'Connection lost. Reconnecting…',
    connectionError: 'Support is temporarily unavailable. Try again later or use WeChat/email.',
    retry: 'Retry',
    sending: 'Sending',
    failed: 'Failed',
    retrySend: 'Retry',
    delivered: 'Delivered',
    read: 'Read',
    typing: 'Typing…',
    closedNotice: 'This conversation is closed. Sending a new message will reopen it.',
    reopen: 'Reopen',
    privacy: 'Messages are stored to reply and improve the service. Do not send passwords or verification codes.',
    empty: 'No messages yet. Say hello.',
    messageTooLong: 'The message is too long. Please shorten it.',
    rateLimited: 'Too many messages. Please wait a moment.',
    csatTitle: 'How was this support?',
    csatComment: 'Add a comment (optional)',
    csatSubmit: 'Submit',
    csatSkip: 'Skip',
    csatThanks: 'Thanks for your feedback.',
    fallback: 'Other contact options',
    unread: 'Unread',
  },
  de: {
    title: 'Live-Support',
    subtitle: 'Wir antworten normalerweise in wenigen Minuten',
    online: 'Online',
    offline: 'Offline',
    open: 'Support öffnen',
    close: 'Schließen',
    loading: 'Verbinden…',
    start: 'Chat starten',
    welcome: 'Hallo — beschreiben Sie kurz Ihr Anliegen. Bei Upload-, Review- oder Kontoproblemen hilft uns der Seitenpfad.',
    placeholder: 'Nachricht schreiben, Enter zum Senden',
    send: 'Senden',
    quickTitle: 'Häufige Fragen',
    quickQuestions: ['Wie lade ich ein Video hoch?', 'Wie teile ich einen Review-Link?', 'Welcher Tarif passt?'],
    offlineNotice: 'Wir sind offline. Ihre Nachricht wird am nächsten Werktag beantwortet.',
    connecting: 'Verbindung zum Support…',
    reconnecting: 'Verbindung unterbrochen. Neuverbindung…',
    connectionError: 'Support ist vorübergehend nicht erreichbar. Bitte später erneut versuchen oder WeChat/E-Mail nutzen.',
    retry: 'Erneut versuchen',
    sending: 'Wird gesendet',
    failed: 'Fehlgeschlagen',
    retrySend: 'Erneut senden',
    delivered: 'Zugestellt',
    read: 'Gelesen',
    typing: 'Schreibt…',
    closedNotice: 'Dieses Gespräch ist beendet. Eine neue Nachricht öffnet es erneut.',
    reopen: 'Erneut öffnen',
    privacy: 'Nachrichten werden zur Beantwortung und Verbesserung gespeichert. Keine Passwörter oder Codes senden.',
    empty: 'Noch keine Nachrichten. Sagen Sie Hallo.',
    messageTooLong: 'Die Nachricht ist zu lang. Bitte kürzen.',
    rateLimited: 'Zu viele Nachrichten. Bitte kurz warten.',
    csatTitle: 'Wie war der Support?',
    csatComment: 'Kommentar (optional)',
    csatSubmit: 'Absenden',
    csatSkip: 'Überspringen',
    csatThanks: 'Danke für Ihr Feedback.',
    fallback: 'Weitere Kontaktwege',
    unread: 'Ungelesen',
  },
  nl: {
    title: 'Live support',
    subtitle: 'We reageren meestal binnen enkele minuten',
    online: 'Online',
    offline: 'Offline',
    open: 'Support openen',
    close: 'Sluiten',
    loading: 'Verbinden…',
    start: 'Chat starten',
    welcome: 'Hallo — vertel kort wat je nodig hebt. Bij upload-, review- of accountproblemen helpt het paginapad ons.',
    placeholder: 'Bericht schrijven, Enter om te verzenden',
    send: 'Verzenden',
    quickTitle: 'Veelgestelde vragen',
    quickQuestions: ['Hoe upload ik een video?', 'Hoe deel ik een reviewlink?', 'Welk abonnement past?'],
    offlineNotice: 'We zijn offline. Je bericht wordt op de volgende werkdag beantwoord.',
    connecting: 'Verbinden met support…',
    reconnecting: 'Verbinding verbroken. Opnieuw verbinden…',
    connectionError: 'Support is tijdelijk niet bereikbaar. Probeer het later opnieuw of gebruik WeChat/e-mail.',
    retry: 'Opnieuw',
    sending: 'Verzenden',
    failed: 'Mislukt',
    retrySend: 'Opnieuw verzenden',
    delivered: 'Afgeleverd',
    read: 'Gelezen',
    typing: 'Typt…',
    closedNotice: 'Dit gesprek is gesloten. Een nieuw bericht opent het opnieuw.',
    reopen: 'Heropenen',
    privacy: 'Berichten worden opgeslagen om te antwoorden en de service te verbeteren. Stuur geen wachtwoorden of codes.',
    empty: 'Nog geen berichten. Zeg hallo.',
    messageTooLong: 'Het bericht is te lang. Maak het korter.',
    rateLimited: 'Te veel berichten. Probeer het zo opnieuw.',
    csatTitle: 'Hoe was de support?',
    csatComment: 'Toelichting (optioneel)',
    csatSubmit: 'Versturen',
    csatSkip: 'Overslaan',
    csatThanks: 'Bedankt voor je feedback.',
    fallback: 'Andere contactmogelijkheden',
    unread: 'Ongelezen',
  },
}

export function resolveSupportLocale(value: string | null | undefined): SupportLocale {
  const base = (value || 'zh').toLowerCase().split('-')[0]
  return (SUPPORT_LOCALES as readonly string[]).includes(base) ? (base as SupportLocale) : 'en'
}

export function getSupportStrings(locale: string | null | undefined): SupportStrings {
  return STRINGS[resolveSupportLocale(locale)]
}
