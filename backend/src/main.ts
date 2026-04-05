import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use Pino logger
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Get config service
  const configService = app.get(ConfigService);

  // Security Headers
  app.use(helmet());

  // CORS Protection
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3001');
  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Ensure sensitive data (like passwords) is excluded from responses
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Swagger/OpenAPI Configuration
  const isProduction = configService.get('NODE_ENV') === 'production';

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Capital Tracker API')
      .setDescription(
        `## Overview
Capital Tracker is a personal finance management API for tracking assets, liabilities, investments, and generating financial insights.

## Authentication
Most endpoints require JWT authentication. Include the token in the Authorization header:
\`Authorization: Bearer <your_token>\`

## Rate Limiting
API endpoints are rate-limited to prevent abuse:
- General endpoints: 100 requests per minute
- Authentication endpoints: 5 requests per minute
- Password reset: 3 requests per minute

## Error Handling
All errors follow a consistent format with appropriate HTTP status codes.`,
      )
      .setVersion('1.0')
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter your JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('auth', 'Authentication and authorization endpoints')
      .addTag('assets', 'Asset management operations')
      .addTag('liabilities', 'Liability management operations')
      .addTag('currencies', 'Currency management and exchange rates')
      .addTag('crypto', 'Cryptocurrency wallet management')
      .addTag('metrics', 'Financial metrics and analytics')
      .addTag('health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
      deepScanRoutes: true,
    });

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
        syntaxHighlight: {
          activate: true,
          theme: 'monokai',
        },
        tryItOutEnabled: true,
      },
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info .title { font-size: 2rem; }
        .swagger-ui .info .description { max-width: none; }
      `,
      customSiteTitle: 'Capital Tracker API Documentation',
    });

    logger.log(
      `Swagger documentation available at: http://localhost:${configService.get<number>('PORT', 3000)}/api/docs`,
    );
  }

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
}

bootstrap().catch((error: Error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
