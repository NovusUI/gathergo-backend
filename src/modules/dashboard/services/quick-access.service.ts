import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface QuickAccessItem {
  id: string;
  title: string;
  link: string;
  iconColor: string;
}

@Injectable()
export class QuickAccessService {
  // Extended color palette with more variety
  private readonly colorPalette = {
    // Primary colors for event types
    donation: ['#5669FF', '#4D44FF', '#3D34FF'], // Blues
    ticket: ['#0FF1CF', '#00D4B4', '#00B89C'], // Teals/cyans
    registration: ['#FF5757', '#FF4151', '#FF2B4B'], // Reds

    // Extended palette for name-based colors
    warm: ['#FF932E', '#FF7B00', '#FF6600'], // Oranges
    cool: ['#9D4EDD', '#8A2BE2', '#7B1FA2'], // Purples
    neutral: ['#808080', '#6C757D', '#495057'], // Grays
    success: ['#28A745', '#218838', '#1E7E34'], // Greens
    warning: ['#FFC107', '#E0A800', '#C69500'], // Yellows
    info: ['#17A2B8', '#138496', '#117A8B'], // Teals

    // Special colors for specific keywords
    medical: ['#FF5757', '#FF4151', '#FF2B4B'], // Reds (matching registration)
    education: ['#0FF1CF', '#00D4B4', '#00B89C'], // Teals (matching ticket)
    housing: ['#9D4EDD', '#8A2BE2', '#7B1FA2'], // Purples
    food: ['#FF932E', '#FF7B00', '#FF6600'], // Oranges
    charity: ['#28A745', '#218838', '#1E7E34'], // Greens
    community: ['#17A2B8', '#138496', '#117A8B'], // Teals
  };

  // Keyword to color category mapping
  private readonly keywordMapping = {
    // Medical/Health keywords
    medical: 'medical',
    health: 'medical',
    hospital: 'medical',
    clinic: 'medical',
    care: 'medical',
    aid: 'medical',
    wellness: 'medical',

    // Education keywords
    education: 'education',
    school: 'education',
    student: 'education',
    learn: 'education',
    study: 'education',
    tuition: 'education',
    scholarship: 'education',
    fund: 'education',

    // Housing keywords
    housing: 'housing',
    home: 'housing',
    shelter: 'housing',
    build: 'housing',
    construction: 'housing',
    renovation: 'housing',

    // Food/Hunger keywords
    food: 'food',
    feed: 'food',
    hunger: 'food',
    meal: 'food',
    nutrition: 'food',
    pantry: 'food',

    // Charity/Donation keywords
    charity: 'charity',
    donate: 'charity',
    giving: 'charity',
    support: 'charity',
    help: 'charity',
    assist: 'charity',

    // Community keywords
    community: 'community',
    together: 'community',
    unity: 'community',
    collective: 'community',
    group: 'community',

    // Event/Entertainment keywords
    concert: 'warm',
    festival: 'warm',
    show: 'warm',
    performance: 'warm',
    party: 'warm',
    celebration: 'warm',

    // Sports keywords
    sports: 'success',
    game: 'success',
    tournament: 'success',
    match: 'success',
    race: 'success',

    // Technology keywords
    tech: 'cool',
    digital: 'cool',
    coding: 'cool',
    hackathon: 'cool',
    workshop: 'cool',
    seminar: 'cool',
  };

  constructor(private prisma: PrismaService) {}

  async getQuickAccess(userId: string): Promise<QuickAccessItem[]> {
    console.log('getting quick access');
    const shortcuts: QuickAccessItem[] = [];

    // 1. Always add Wallet shortcut (default orange)
    shortcuts.push({
      id: 'wallet',
      title: 'Wallet',
      link: 'wallet',
      iconColor: this.getColorByKeyword('wallet', 'warm'),
    });

    // 2. Get user's OWNED events (active/upcoming only)
    const now = new Date();

    const ownedEvents = await this.prisma.event.findMany({
      where: {
        creatorId: userId, // Only events user OWNS
        endDate: { gte: now }, // Only upcoming/active events
      },
      select: {
        id: true,
        title: true,
        registrationType: true,
        startDate: true,
      },
      orderBy: { startDate: 'asc' },
      take: 7, // Limit to 7 most relevant owned events
    });

    // 3. Process and add owned event shortcuts with intelligent color assignment
    for (const event of ownedEvents) {
      // Get color based on event name, type, and index for variety
      const iconColor = this.getEventColor(event, ownedEvents.indexOf(event));

      shortcuts.push({
        id: event.id,
        title: event.title,
        link: `dashboard/${event.id}`,
        iconColor,
      });
    }

    // 4. If user has no events, add create event shortcut
    if (shortcuts.length === 1) {
      // Only wallet
      shortcuts.push({
        id: 'create-event',
        title: 'Create Event',
        link: 'events/create',
        iconColor: this.getColorByKeyword('create', 'neutral'),
      });
    }

    // 5. Ensure we have a reasonable number of shortcuts (max 8)
    return shortcuts.slice(0, 8);
  }

  /**
   * Get color for an event based on multiple factors:
   * 1. Event name keywords
   * 2. Event registration type
   * 3. Event index in list (for variety)
   */
  private getEventColor(event: any, index: number): string {
    const title = event.title.toLowerCase();
    const registrationType = event.registrationType?.toLowerCase();

    // First, try to match by event name keywords
    const keywordCategory = this.getKeywordCategory(title);

    if (keywordCategory) {
      // Use keyword-based color with index variation
      return this.getColorByKeyword(keywordCategory, keywordCategory, index);
    }

    // If no keyword match, use registration type with index variation
    if (registrationType) {
      return this.getColorByKeyword(registrationType, registrationType, index);
    }

    // Fallback: Use index-based color from warm palette
    return this.getColorByKeyword('general', 'warm', index);
  }

  /**
   * Find which keyword category the event title matches
   */
  private getKeywordCategory(title: string): string | null {
    for (const [keyword, category] of Object.entries(this.keywordMapping)) {
      if (title.includes(keyword.toLowerCase())) {
        return category;
      }
    }
    return null;
  }

  /**
   * Get color based on category with index variation
   */
  private getColorByKeyword(
    keyword: string,
    category: string,
    index: number = 0,
  ): string {
    const palette = this.colorPalette[category] || this.colorPalette.neutral;

    // Use index to cycle through colors in the palette
    // This ensures even if we have multiple events of same category, they get different shades
    const colorIndex = index % palette.length;

    return palette[colorIndex];
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/--+/g, '-') // Replace multiple hyphens with single
      .trim();
  }

  /**
   * Get quick access shortcuts for a specific event context
   * Only shows events user OWNS
   */
  async getEventQuickAccess(
    userId: string,
    currentEventId: string,
  ): Promise<QuickAccessItem[]> {
    const shortcuts: QuickAccessItem[] = [];

    // 1. Always add Wallet shortcut
    shortcuts.push({
      id: 'wallet',
      title: 'Wallet',
      link: 'wallet',
      iconColor: this.getColorByKeyword('wallet', 'warm'),
    });

    // 2. Get current event (must be owned by user)
    const currentEvent = await this.prisma.event.findUnique({
      where: {
        id: currentEventId,
        creatorId: userId, // User must OWN the event
      },
      select: {
        id: true,
        title: true,
        registrationType: true,
      },
    });

    if (currentEvent) {
      shortcuts.push({
        id: currentEvent.id,
        title: currentEvent.title,
        link: `events/${currentEvent.id}`,
        iconColor: this.getEventColor(currentEvent, 0), // Current event gets first color
      });
    }

    // 3. Get other events user OWNS (excluding current one)
    const now = new Date();
    const otherOwnedEvents = await this.prisma.event.findMany({
      where: {
        creatorId: userId,
        id: { not: currentEventId },
        endDate: { gte: now }, // Only active/upcoming
      },
      select: {
        id: true,
        title: true,
        registrationType: true,
        startDate: true,
      },
      orderBy: { startDate: 'asc' },
      take: 6, // Get up to 6 other events
    });

    // 4. Add other owned events with distinct colors
    otherOwnedEvents.forEach((event, index) => {
      // Start colors from index 1 (since current event is at index 0)
      const colorIndex = index + 1;

      shortcuts.push({
        id: event.id,
        title: event.title,
        link: `events/${event.id}`,
        iconColor: this.getEventColor(event, colorIndex),
      });
    });

    // 5. If we have less than 5 shortcuts, add create event shortcut
    if (shortcuts.length < 5) {
      shortcuts.push({
        id: 'create-event',
        title: 'Create Event',
        link: 'events/create',
        iconColor: this.getColorByKeyword('create', 'neutral'),
      });
    }

    return shortcuts.slice(0, 8);
  }

  /**
   * Alternative: Simple random color assignment for quick access
   * This provides maximum variety with no pattern
   */
  async getQuickAccessRandom(userId: string): Promise<QuickAccessItem[]> {
    const shortcuts: QuickAccessItem[] = [];

    // 1. Always add Wallet shortcut
    shortcuts.push({
      id: 'wallet',
      title: 'Wallet',
      link: 'wallet',
      iconColor: '#FF932E', // Fixed orange for wallet
    });

    // 2. Get user's OWNED events
    const now = new Date();

    const ownedEvents = await this.prisma.event.findMany({
      where: {
        creatorId: userId,
        endDate: { gte: now },
      },
      select: {
        id: true,
        title: true,
      },
      orderBy: { startDate: 'asc' },
      take: 7,
    });

    // 3. Predefined random colors for variety
    const randomColors = [
      '#5669FF',
      '#0FF1CF',
      '#FF5757',
      '#9D4EDD',
      '#FF932E',
      '#28A745',
      '#17A2B8',
      '#FFC107',
      '#4D44FF',
      '#00D4B4',
      '#FF4151',
      '#8A2BE2',
      '#FF7B00',
      '#218838',
      '#138496',
      '#E0A800',
    ];

    // 4. Assign random colors to events
    ownedEvents.forEach((event, index) => {
      // Use index to select color, cycling through array
      const colorIndex = index % randomColors.length;

      shortcuts.push({
        id: event.id,
        title: event.title,
        link: `dashboard/${event.id}`,
        iconColor: randomColors[colorIndex],
      });
    });

    // 5. Add create event if needed
    if (shortcuts.length === 1) {
      shortcuts.push({
        id: 'create-event',
        title: 'Create Event',
        link: 'events/create',
        iconColor: '#808080', // Neutral gray
      });
    }

    return shortcuts.slice(0, 8);
  }

  /**
   * Alternative: Color by first letter of event name
   * Provides consistent colors for same event names
   */
  async getQuickAccessByLetter(userId: string): Promise<QuickAccessItem[]> {
    const shortcuts: QuickAccessItem[] = [];

    // 1. Wallet shortcut
    shortcuts.push({
      id: 'wallet',
      title: 'Wallet',
      link: 'wallet',
      iconColor: '#FF932E',
    });

    // 2. Get user's OWNED events
    const now = new Date();

    const ownedEvents = await this.prisma.event.findMany({
      where: {
        creatorId: userId,
        endDate: { gte: now },
      },
      select: {
        id: true,
        title: true,
      },
      orderBy: { startDate: 'asc' },
      take: 7,
    });

    // 3. Color mapping by first letter (A-Z)
    const letterColors: Record<string, string> = {
      a: '#5669FF',
      b: '#0FF1CF',
      c: '#FF5757',
      d: '#9D4EDD',
      e: '#FF932E',
      f: '#28A745',
      g: '#17A2B8',
      h: '#FFC107',
      i: '#4D44FF',
      j: '#00D4B4',
      k: '#FF4151',
      l: '#8A2BE2',
      m: '#FF7B00',
      n: '#218838',
      o: '#138496',
      p: '#E0A800',
      q: '#3D34FF',
      r: '#00B89C',
      s: '#FF2B4B',
      t: '#7B1FA2',
      u: '#FF6600',
      v: '#1E7E34',
      w: '#117A8B',
      x: '#C69500',
      y: '#6C757D',
      z: '#495057',
    };

    // 4. Assign colors based on first letter
    ownedEvents.forEach((event) => {
      const firstLetter = event.title.charAt(0).toLowerCase();
      const iconColor = letterColors[firstLetter] || '#808080'; // Default gray

      shortcuts.push({
        id: event.id,
        title: event.title,
        link: `dashboard/${event.id}`,
        iconColor,
      });
    });

    // 5. Add create event if needed
    if (shortcuts.length === 1) {
      shortcuts.push({
        id: 'create-event',
        title: 'Create Event',
        link: 'events/create',
        iconColor: '#808080',
      });
    }

    return shortcuts.slice(0, 8);
  }
}
