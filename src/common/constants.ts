export const notificationConstants = {
  CARPOOL_REQUEST_TITLE_REQUEST: 'New carpool request',
  CARPOOL_REQUEST_MESSAGE_REQUEST: (username: string, eventName: string) =>
    `@${username} is requesting to join your carpool to ${eventName}`,
  CARPOOL_NOTIFICATION_TYPE_REQUEST: 'carpool_request',
  CARPOOL_REQUEST_TITLE_ACCEPTED: 'You have a ride!  🎉🎉🎉',
  CARPOOL_REQUEST_MESSAGE_ACCEPTED: (username: string, eventName: string) =>
    `@${username}  accepted your carpool request for ${eventName}. Click for more details `,
  CARPOOL_NOTIFICATION_TYPE_ACCEPTED: 'carpool_accepted_request',
  CARPOOL_REQUEST_TITLE_REJECTED: 'Ooops! ',
  CARPOOL_REQUEST_MESSAGE_REJECT: 'your carpool request was rejected',
  CARPOOL_NOTIFICATION_TYPE_REJECTED: 'carpool_rejected_request',
  CARPOOL_REQUEST_TITLE_CANCELLED: 'Carpool Closed',
  CARPOOL_REQUEST_MESSAGE_CANCELLED: (eventname: string) =>
    `Carpool to ${eventname} was closed`,
  CARPOOL_NOTIFICATION_TYPE_CANCELLED: 'carpool_cancelled',
  CARPOOL_REQUEST_TITLE_REMOVED: 'Oops!',
  CARPOOL_REQUEST_MESSAGE_REMOVED: 'You were removed from a carpool',
  CARPOOL_NOTIFICATION_TYPE_REMOVED: 'carpool_removed',
  CARPOOL_REQUEST_TITLE_LEFT: 'Passenger left carpool',
  CARPOOL_REQUEST_MESSAGE_LEFT: (username) =>
    `@${username} just left your capool`,
  CARPOOL_NOTIFICATION_TYPE_LEFT: 'carpool_left',

  EVENT_TICKET_SALE: 'event_ticket_sale',
  EVENT_TICKET_SALE_MESSAGE: (name) =>
    `${name ?? 'A user '} just bout a ticket`,
  EVENT_TICKET_SALE_TITLE: 'Ticket sale alert!',

  EVENT_REGISTRATION: 'event_registration',
  EVENT_REGISTRATION_MESSAGE: (name) =>
    `${name ?? 'A user '} just registered for your event`,
  EVENT_REGISTRATION_TITLE: 'Registration  alert!',

  EVENT_DONATION: 'event_donation',
  EVENT_DONATION_TITLE: 'Donation alert!',
  EVENT_DONATION_MESSAGE: (name: string, amount: number) =>
    `${name ?? 'A user '} just donated ${amount}`,
};
