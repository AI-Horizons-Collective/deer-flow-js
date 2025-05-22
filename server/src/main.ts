import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  // Enable CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: '*',
    credentials: true,
  })
  app.setGlobalPrefix('api')
  await app.listen(process.env.PORT ?? 8001)
}
void bootstrap()
