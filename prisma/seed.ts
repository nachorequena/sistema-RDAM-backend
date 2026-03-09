import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Tipos de certificado
  const tipos = await Promise.all([
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_DOMICILIO' },
      update: {},
      create: { codigo: 'CERT_DOMICILIO', descripcion: 'Certificado de Domicilio', precio: 1200.00 },
    }),
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_ANTECEDENTES' },
      update: {},
      create: { codigo: 'CERT_ANTECEDENTES', descripcion: 'Certificado de Antecedentes', precio: 2500.00 },
    }),
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_ESTADO_CIVIL' },
      update: {},
      create: { codigo: 'CERT_ESTADO_CIVIL', descripcion: 'Certificado de Estado Civil', precio: 1800.00 },
    }),
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_RESIDENCIA' },
      update: {},
      create: { codigo: 'CERT_RESIDENCIA', descripcion: 'Certificado de Residencia', precio: 1200.00 },
    }),
  ]);

  // Admin inicial
  const passwordHash = await bcrypt.hash('Admin1234!', 12);
  const admin = await prisma.usuarioInterno.upsert({
    where: { email: 'admin@rdam.gob.ar' },
    update: {},
    create: {
      nombre: 'Administrador RDAM',
      email: 'admin@rdam.gob.ar',
      passwordHash,
      rol: 'admin',
      activo: true,
    },
  });

  const passwordHashGestor = await bcrypt.hash('Gestor1234!', 12);
  await prisma.usuarioInterno.upsert({
    where: { email: 'gestor@rdam.gob.ar' },
    update: {},
    create: {
      nombre: 'Gestor Ejemplo',
      email: 'gestor@rdam.gob.ar',
      passwordHash: passwordHashGestor,
      rol: 'gestor',
      activo: true,
    },
  });

  console.log(`✅ ${tipos.length} tipos de certificado`);
  console.log(`✅ Usuario admin: admin@rdam.gob.ar / Admin1234!`);
  console.log(`✅ Usuario gestor: gestor@rdam.gob.ar / Gestor1234!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
