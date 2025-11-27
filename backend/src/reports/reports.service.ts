import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportType } from '../entities/report.entity';
import { Asset } from '../entities/asset.entity';
import { Liability } from '../entities/liability.entity';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
    @InjectRepository(Liability)
    private liabilityRepository: Repository<Liability>,
    @InjectRepository(CryptoWallet)
    private cryptoWalletRepository: Repository<CryptoWallet>,
  ) {}

  async create(userId: string, createDto: CreateReportDto): Promise<Report> {
    const report = this.reportRepository.create({
      ...createDto,
      userId,
    });
    return this.reportRepository.save(report);
  }

  async findAll(userId: string): Promise<Report[]> {
    return this.reportRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Report> {
    const report = await this.reportRepository.findOne({
      where: { id, userId },
    });
    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }
    return report;
  }

  async generateReport(id: string, userId: string): Promise<Report> {
    const report = await this.findOne(id, userId);

    // Collect data based on report type
    let reportData: any = {};

    switch (report.type) {
      case ReportType.FINANCIAL_SUMMARY:
        reportData = await this.generateFinancialSummary(userId, report.capitalId);
        break;
      case ReportType.ASSET_ALLOCATION:
        reportData = await this.generateAssetAllocation(userId, report.capitalId);
        break;
      case ReportType.PERFORMANCE:
        reportData = await this.generatePerformanceReport(userId, report.capitalId);
        break;
      default:
        reportData = {};
    }

    report.data = reportData;
    report.generatedAt = new Date();
    return this.reportRepository.save(report);
  }

  async remove(id: string, userId: string): Promise<void> {
    const report = await this.findOne(id, userId);
    await this.reportRepository.remove(report);
  }

  private async generateFinancialSummary(userId: string, _capitalId?: string): Promise<any> {
    const assets = await this.assetRepository.find({
      where: { userId },
    });
    const liabilities = await this.liabilityRepository.find({
      where: { userId },
    });
    const cryptoWallets = await this.cryptoWalletRepository.find({
      where: { userId },
    });

    const totalAssets = assets.reduce((sum, asset) => sum + Number(asset.amount), 0);
    const totalLiabilities = liabilities.reduce(
      (sum, liability) => sum + Number(liability.amount),
      0,
    );
    const totalCrypto = cryptoWallets.reduce((sum, wallet) => sum + Number(wallet.balance), 0);

    return {
      totalAssets: totalAssets + totalCrypto,
      totalLiabilities,
      netWorth: totalAssets + totalCrypto - totalLiabilities,
      assetsCount: assets.length,
      liabilitiesCount: liabilities.length,
      cryptoWalletsCount: cryptoWallets.length,
      generatedAt: new Date(),
    };
  }

  private async generateAssetAllocation(userId: string, _capitalId?: string): Promise<any> {
    const assets = await this.assetRepository.find({
      where: { userId },
    });
    const cryptoWallets = await this.cryptoWalletRepository.find({
      where: { userId },
    });

    const allocation: Record<string, number> = {};

    assets.forEach((asset) => {
      const category = asset.category || 'other';
      allocation[category] = (allocation[category] || 0) + Number(asset.amount);
    });

    const totalCrypto = cryptoWallets.reduce((sum, wallet) => sum + Number(wallet.balance), 0);
    if (totalCrypto > 0) {
      allocation['crypto'] = (allocation['crypto'] || 0) + totalCrypto;
    }

    return {
      allocation,
      total: Object.values(allocation).reduce((sum, val) => sum + val, 0),
      generatedAt: new Date(),
    };
  }

  private async generatePerformanceReport(_userId: string, _capitalId?: string): Promise<any> {
    // TODO: Implement performance tracking over time
    return {
      message: 'Performance report generation not yet implemented',
      generatedAt: new Date(),
    };
  }
}
