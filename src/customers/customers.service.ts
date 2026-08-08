import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CrmProvisioningService } from './crm-provisioning.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomersService {
  private readonly crmBaseDomain: string;
  private readonly crmProtocol: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crmProvisioning: CrmProvisioningService,
  ) {
    this.crmBaseDomain = this.config.get<string>(
      'CRM_BASE_DOMAIN',
      'crm.dabriz.com',
    );
    this.crmProtocol = this.config.get<string>('CRM_PROTOCOL', 'https');
  }

  private buildCustomerUrl(slug: string): string {
    return `${this.crmProtocol}://${slug}.${this.crmBaseDomain}`;
  }

  private toResponse(customer: {
    id: number;
    name: string;
    slug: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: customer.id,
      name: customer.name,
      slug: customer.slug,
      email: customer.email,
      url: this.buildCustomerUrl(customer.slug),
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  private slugify(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private async generateUniqueSlug(baseName: string): Promise<string> {
    const base = this.slugify(baseName) || 'customer';
    let slug = base;
    let counter = 2;

    while (await this.prisma.customer.findUnique({ where: { slug } })) {
      slug = `${base}-${counter}`;
      counter += 1;
    }

    return slug;
  }

  private async ensureUniqueSlug(slug: string): Promise<string> {
    const existing = await this.prisma.customer.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException('Slug is already taken');
    }
    return slug;
  }

  async create(dto: CreateCustomerDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.customer.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('A customer with this email already exists');
    }

    const slug = dto.slug
      ? await this.ensureUniqueSlug(this.slugify(dto.slug))
      : await this.generateUniqueSlug(dto.name);

    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const customer = await this.prisma.customer.create({
        data: {
          name: dto.name.trim(),
          slug,
          email,
          passwordHash,
        },
      });

      // Best-effort: CRM keeps its own Tenant row; failure does not roll back Customer
      await this.crmProvisioning.provisionTenant(customer);

      return this.toResponse(customer);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Customer email or slug already exists');
      }
      throw error;
    }
  }

  async findAll() {
    const customers = await this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return customers.map((customer) => this.toResponse(customer));
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });

    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }

    return this.toResponse(customer);
  }

  async update(id: number, dto: UpdateCustomerDto) {
    await this.findOne(id);

    const data: Prisma.CustomerUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      data.email = dto.email.toLowerCase();
    }

    if (dto.slug !== undefined) {
      const slug = this.slugify(dto.slug);
      const conflict = await this.prisma.customer.findFirst({
        where: { slug, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException('Slug is already taken');
      }
      data.slug = slug;
    }

    if (dto.password !== undefined) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
    }

    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data,
      });

      if (dto.name !== undefined || dto.slug !== undefined) {
        await this.crmProvisioning.provisionTenant(customer);
      }

      return this.toResponse(customer);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Customer email or slug already exists');
      }
      throw error;
    }
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.customer.delete({ where: { id } });
    return { message: `Customer #${id} deleted` };
  }
}
