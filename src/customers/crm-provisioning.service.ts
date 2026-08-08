import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CrmProvisioningService {
  private readonly logger = new Logger(CrmProvisioningService.name);
  private readonly crmApiUrl: string | undefined;
  private readonly provisioningSecret: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.crmApiUrl = this.config.get<string>('CRM_API_URL');
    this.provisioningSecret = this.config.get<string>('CRM_PROVISIONING_SECRET');
  }

  async provisionTenant(customer: {
    id: number;
    name: string;
    slug: string;
    email: string;
  }) {
    if (!this.crmApiUrl || !this.provisioningSecret) {
      this.logger.warn(
        'CRM_API_URL or CRM_PROVISIONING_SECRET not set — skipping tenant provisioning',
      );
      return;
    }

    const url = `${this.crmApiUrl.replace(/\/$/, '')}/internal/tenants`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provisioning-Secret': this.provisioningSecret,
        },
        body: JSON.stringify({
          externalCustomerId: String(customer.id),
          name: customer.name,
          slug: customer.slug,
          email: customer.email,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(
          `Failed to provision CRM tenant for customer #${customer.id}: ${response.status} ${text}`,
        );
        return;
      }

      this.logger.log(
        `Provisioned CRM tenant for customer #${customer.id} (${customer.slug})`,
      );
    } catch (error) {
      this.logger.error(
        `CRM provisioning request failed for customer #${customer.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
