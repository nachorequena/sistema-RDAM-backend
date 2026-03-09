const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database (CJS)...');

  const tipos = await Promise.all([
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_DOMICILIO' },
      update: {},
      create: { codigo: 'CERT_DOMICILIO', descripcion: 'Certificado de Domicilio', precio: 1200.0 },
    }),
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_ANTECEDENTES' },
      update: {},
      create: { codigo: 'CERT_ANTECEDENTES', descripcion: 'Certificado de Antecedentes', precio: 2500.0 },
    }),
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_ESTADO_CIVIL' },
      update: {},
      create: { codigo: 'CERT_ESTADO_CIVIL', descripcion: 'Certificado de Estado Civil', precio: 1800.0 },
    }),
    prisma.tipoCertificado.upsert({
      where: { codigo: 'CERT_RESIDENCIA' },
      update: {},
      create: { codigo: 'CERT_RESIDENCIA', descripcion: 'Certificado de Residencia', precio: 1200.0 },
    }),
  ]);

  const passwordHash = await bcrypt.hash('Admin1234!', 12);
  await prisma.usuarioInterno.upsert({
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
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
