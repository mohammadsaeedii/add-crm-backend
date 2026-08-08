import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CrmProvisioningService } from './crm-provisioning.service.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CrmProvisioningService],
})
export class CustomersModule {}
