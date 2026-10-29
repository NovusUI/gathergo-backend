import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, ShortLink, ShortLinkKind } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ShortLinksService } from './short-links.service';

const targetId = '00000000-0000-4000-8000-000000000001';
const link: ShortLink = {
  code: '8nQ4xK2p',
  kind: ShortLinkKind.event,
  targetId,
  createdAt: new Date(),
};
const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: '6.10.1',
  });

describe('Short links', () => {
  const prisma = {
    event: { findUnique: jest.fn() },
    carpool: { findUnique: jest.fn() },
    shortLink: {
      findUnique: jest.fn<
        Promise<ShortLink | null>,
        [Prisma.ShortLinkFindUniqueArgs]
      >(),
      create: jest.fn<Promise<ShortLink>, [Prisma.ShortLinkCreateArgs]>(),
    },
  };
  let service: ShortLinksService;
  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.event.findUnique.mockResolvedValue({ registrationType: 'foodbank' });
    prisma.carpool.findUnique.mockResolvedValue({ id: targetId });
    prisma.shortLink.findUnique.mockResolvedValue(null);
    prisma.shortLink.create.mockResolvedValue(link);
    const module = await Test.createTestingModule({
      providers: [
        ShortLinksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ShortLinksService);
  });
  it('creates an eight-character URL-safe random code for a verified target', async () => {
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).resolves.toEqual(link);
    expect(prisma.shortLink.create.mock.calls[0][0].data).toMatchObject({
      kind: 'event',
      targetId,
    });
    expect(prisma.shortLink.create.mock.calls[0][0].data.code).toMatch(
      /^[A-Za-z0-9_-]{8}$/,
    );
  });
  it('reuses the existing link and does not rotate previously shared codes', async () => {
    prisma.shortLink.findUnique.mockResolvedValue(link);
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).resolves.toEqual(link);
    expect(prisma.shortLink.create).not.toHaveBeenCalled();
  });
  it('distinguishes the event page and food collection destination for the same event', async () => {
    await service.create({ kind: ShortLinkKind.foodbank, targetId });
    expect(prisma.shortLink.findUnique).toHaveBeenCalledWith({
      where: { kind_targetId: { kind: 'foodbank', targetId } },
    });
    expect(prisma.shortLink.create.mock.calls[0][0].data.kind).toBe('foodbank');
  });
  it('looks up carpool targets through the actual carpool model', async () => {
    await service.create({ kind: ShortLinkKind.carpool, targetId });
    expect(prisma.carpool.findUnique).toHaveBeenCalledWith({
      where: { id: targetId, isDeleted: false },
      select: { id: true },
    });
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });
  it('rejects absent events before writing a mapping', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.shortLink.create).not.toHaveBeenCalled();
  });
  it('does not create meal collection links for another event type', async () => {
    prisma.event.findUnique.mockResolvedValue({ registrationType: 'ticket' });
    await expect(
      service.create({ kind: ShortLinkKind.foodbank, targetId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects absent carpools before writing a mapping', async () => {
    prisma.carpool.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ kind: ShortLinkKind.carpool, targetId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.shortLink.create).not.toHaveBeenCalled();
  });
  it('returns the concurrent winner when two requests shorten the same destination', async () => {
    prisma.shortLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(link);
    prisma.shortLink.create.mockRejectedValueOnce(duplicate());
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).resolves.toEqual(link);
    expect(prisma.shortLink.create).toHaveBeenCalledTimes(1);
  });
  it('retries a random-code collision without replacing an existing destination', async () => {
    prisma.shortLink.create
      .mockRejectedValueOnce(duplicate())
      .mockResolvedValueOnce(link);
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).resolves.toEqual(link);
    expect(prisma.shortLink.create).toHaveBeenCalledTimes(2);
  });
  it('bounds collision retries and keeps database errors visible', async () => {
    prisma.shortLink.create.mockRejectedValue(duplicate());
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.shortLink.create).toHaveBeenCalledTimes(5);
    prisma.shortLink.create
      .mockReset()
      .mockRejectedValue(new Error('Database unavailable'));
    await expect(
      service.create({ kind: ShortLinkKind.event, targetId }),
    ).rejects.toThrow('Database unavailable');
    expect(prisma.shortLink.create).toHaveBeenCalledTimes(1);
  });
  it('resolves the original destination and checks that it still exists', async () => {
    prisma.shortLink.findUnique.mockResolvedValue(link);
    await expect(service.resolve(link.code)).resolves.toEqual(link);
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.resolve(link.code)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('returns a not-found error for an unknown code', async () => {
    await expect(service.resolve('missing1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });
});
