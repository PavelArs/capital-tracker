import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrokerIntegration, BrokerType, IntegrationStatus } from '../entities/broker-integration.entity';
import { BankIntegration, BankType } from '../entities/bank-integration.entity';
import { CreateBrokerIntegrationDto } from './dto/create-broker-integration.dto';
import { CreateBankIntegrationDto } from './dto/create-bank-integration.dto';

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(BrokerIntegration)
    private brokerIntegrationRepository: Repository<BrokerIntegration>,
    @InjectRepository(BankIntegration)
    private bankIntegrationRepository: Repository<BankIntegration>,
  ) {}

  // Broker Integrations
  async createBrokerIntegration(
    userId: string,
    createDto: CreateBrokerIntegrationDto,
  ): Promise<BrokerIntegration> {
    const integration = this.brokerIntegrationRepository.create({
      ...createDto,
      userId,
    });
    return this.brokerIntegrationRepository.save(integration);
  }

  async getBrokerIntegrations(userId: string): Promise<BrokerIntegration[]> {
    return this.brokerIntegrationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getBrokerIntegration(
    id: string,
    userId: string,
  ): Promise<BrokerIntegration> {
    const integration = await this.brokerIntegrationRepository.findOne({
      where: { id, userId },
    });
    if (!integration) {
      throw new NotFoundException('Broker integration not found');
    }
    return integration;
  }

  async updateBrokerIntegration(
    id: string,
    userId: string,
    updateData: Partial<BrokerIntegration>,
  ): Promise<BrokerIntegration> {
    const integration = await this.getBrokerIntegration(id, userId);
    Object.assign(integration, updateData);
    return this.brokerIntegrationRepository.save(integration);
  }

  async deleteBrokerIntegration(id: string, userId: string): Promise<void> {
    const integration = await this.getBrokerIntegration(id, userId);
    await this.brokerIntegrationRepository.remove(integration);
  }

  async syncBrokerIntegration(
    id: string,
    userId: string,
  ): Promise<BrokerIntegration> {
    const integration = await this.getBrokerIntegration(id, userId);
    // TODO: Implement actual sync logic with broker API
    integration.lastSyncAt = new Date();
    integration.status = IntegrationStatus.ACTIVE;
    return this.brokerIntegrationRepository.save(integration);
  }

  // Bank Integrations
  async createBankIntegration(
    userId: string,
    createDto: CreateBankIntegrationDto,
  ): Promise<BankIntegration> {
    const integration = this.bankIntegrationRepository.create({
      ...createDto,
      userId,
    });
    return this.bankIntegrationRepository.save(integration);
  }

  async getBankIntegrations(userId: string): Promise<BankIntegration[]> {
    return this.bankIntegrationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getBankIntegration(
    id: string,
    userId: string,
  ): Promise<BankIntegration> {
    const integration = await this.bankIntegrationRepository.findOne({
      where: { id, userId },
    });
    if (!integration) {
      throw new NotFoundException('Bank integration not found');
    }
    return integration;
  }

  async updateBankIntegration(
    id: string,
    userId: string,
    updateData: Partial<BankIntegration>,
  ): Promise<BankIntegration> {
    const integration = await this.getBankIntegration(id, userId);
    Object.assign(integration, updateData);
    return this.bankIntegrationRepository.save(integration);
  }

  async deleteBankIntegration(id: string, userId: string): Promise<void> {
    const integration = await this.getBankIntegration(id, userId);
    await this.bankIntegrationRepository.remove(integration);
  }

  async syncBankIntegration(
    id: string,
    userId: string,
  ): Promise<BankIntegration> {
    const integration = await this.getBankIntegration(id, userId);
    // TODO: Implement actual sync logic with bank API
    integration.lastSyncAt = new Date();
    integration.status = IntegrationStatus.ACTIVE;
    return this.bankIntegrationRepository.save(integration);
  }
}

