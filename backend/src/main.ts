import { NestFactory, Reflector } from "@nestjs/core";
import { ValidationPipe, ClassSerializerInterceptor } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security Headers
  app.use(helmet());

  // CORS Protection
  app.enableCors({
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true, // Fail if extra fields are sent (Security)
    })
  );

  // Ensure sensitive data (like passwords) is excluded from responses
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
