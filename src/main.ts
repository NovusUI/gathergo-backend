import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DocumentBuilder,SwaggerModule } from '@nestjs/swagger'
import { ResponseInterceptor } from './common/interceptors/response.interceptors';
import { ValidationPipe } from '@nestjs/common';
import { createCorsOriginValidator, getPort } from './config/runtime-env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const port = getPort();

  app.setGlobalPrefix('api/v1')
  app.enableShutdownHooks();
  app.set('trust proxy', 1);
  // Swagger configuration

  const config = new DocumentBuilder()
    .setTitle('Gathergo api')
    .setDescription('API documentation for GatherGo backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app,config)
  SwaggerModule.setup('api',app,document)

  app.useGlobalInterceptors(new ResponseInterceptor())
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true, // Enables auto-type conversion (e.g., string to number/date)
    transformOptions: { enableImplicitConversion: true },
  }));

  app.enableCors({
    origin: createCorsOriginValidator(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS','PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type', 'x-ops-key']
  });
  
  await app.listen(port, '0.0.0.0');
}
bootstrap();
