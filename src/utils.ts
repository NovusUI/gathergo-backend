export const DEFAULT_CARPOOL_NOTES = {
  morning: [
    'Coffee is fuel, car is secondary ☕🚗',
    'Morning vibes, but I can’t promise I’m fully awake 🌞',
    'If you bring donuts, you’re my favorite 🍩',
    'Caffeine before conversation please 🙃',
    'We’re chasing sun, not traffic 🌅',
    'Good morning… let’s pretend we love traffic 😇',
    'Warning: driver may still be dreaming 💤',
    'Early ride, but we roll with it 🌄',
    'This car accepts coffee as payment ☕',
    'Morning playlist = soft vibes only 🎶',
  ],
  afternoon: [
    'Post-lunch cruise, no naps allowed 🍔➡️🚗',
    'Warning: slight food coma possible 😴',
    'Windows down, playlist up 🎶',
    'Traffic is just car meditation 🧘',
    'Afternoon drive = snack o’clock 🥨',
    'Fuel for the car, fuel for the soul 🌞',
    'Let’s pretend we’re not stuck in traffic 🚦',
    'Daylight rides = free vitamin D 🌤️',
    'Car seats warmer than my office chair 🪑',
    'Road trip mood, but short edition 🛣️',
  ],
  evening: [
    'Sunset rides and good vibes 🌇',
    'DJ gets aux cord, driver keeps sanity 🎧',
    'No rush, just vibes 🌙',
    'This is not Uber, tips = jokes only 😏',
    'Streetlights, snacks, and singalongs ✨',
    'Night rides come with free stargazing 🌌',
    'Traffic after dark is just neon art 💡',
    'Chill beats, cooler streets 🎶',
    'Driver may accept snacks as fuel 🍫',
    'Nighttime = fewer cars, more laughs 😎',
  ],
  weekend: [
    'Saturday = good music and better moods 🎶',
    'Sunday drives cure everything 🛣️',
    'Weekend vibes only, no Monday talk 🚫📅',
    'Let’s escape the city like we mean it 🌳',
    'Saturday carpools > Saturday chores 😎',
    'Weekend fuel: laughter + snacks 🥤',
    'No alarms, just adventures 🔔❌',
    'Sunday chill ride, stress not allowed 😌',
    'Saturday night fever, but car edition 🚗✨',
    'Good company makes the best weekend ride 🙌',
  ],
  generic: [
    'Hop in, I promise not to sing... much 🎤',
    'No road rage included in this ride 😇',
    'I brake for snacks 🥨',
    'Extra points if you bring coffee ☕',
    'My GPS and I are frenemies 🗺️',
    'Yes, this car has AC and bad jokes ❄️😂',
    'Let’s make traffic fun together 🚦',
    'Shotgun calls dibs on DJ duties 🎶',
    'Don’t worry, I only speed in Mario Kart 🏎️',
    'Conversation level = light banter only 😌',
    'Fasten seatbelts, sarcasm ahead 🛑',
    'This ride powered by memes and good vibes 📱✨',
    'Car smells like victory… or fries 🍟',
    'No politics, only playlists 🎧',
    'Aux cord = great responsibility 🎶',
    'Trust me, my car runs on good jokes 😏',
    'Honk if you love carpools 🎺',
    'Zero stars on Yelp, five stars in fun ⭐',
    'Don’t worry, I googled how to drive 🚗💨',
    'Laughs included at no extra charge 😂',
  ],
};

export function getRandomNote(): string {
  const hour = new Date().getHours();

  let category: keyof typeof DEFAULT_CARPOOL_NOTES = 'generic';

  if (hour >= 5 && hour < 12) category = 'morning';
  else if (hour >= 12 && hour < 17) category = 'afternoon';
  else if (hour >= 17 && hour < 22) category = 'evening';

  // weekend override
  const day = new Date().getDay(); // 0=Sunday, 6=Saturday
  if (day === 0 || day === 6) category = 'weekend';

  const pool = DEFAULT_CARPOOL_NOTES[category];
  const index = Math.floor(Math.random() * pool.length);

  return pool[index];
}

export function formatPayment(payment: any) {
  return {
    id: payment.id,
    name: payment.user.name || 'Anonymous',
    amount: payment.amount / 100,
    time: payment.createdAt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    date: payment.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    event: payment.event?.title || 'General Payment',
  };
}
