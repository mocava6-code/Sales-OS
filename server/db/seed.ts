import { normalizeEmail } from "../../lib/utils/email";
import { prisma } from "./client";

const PILOT_BUSINESS_NAME = "Koriaki";
const PILOT_OWNER = {
  name: "Mosiah Carrasco",
  email: normalizeEmail("mocava6@gmail.com"),
};

async function main() {
  const business = await prisma.business.upsert({
    where: { name: PILOT_BUSINESS_NAME },
    update: {},
    create: { name: PILOT_BUSINESS_NAME },
  });

  const owner = await prisma.user.upsert({
    where: { email: PILOT_OWNER.email },
    update: {},
    create: {
      name: PILOT_OWNER.name,
      email: PILOT_OWNER.email,
      role: "OWNER",
      businessId: business.id,
      authUserId: null,
    },
  });

  if (!business.ownerUserId) {
    await prisma.business.update({
      where: { id: business.id },
      data: { ownerUserId: owner.id },
    });
  }

  console.log(`Seeded business "${business.name}" (${business.id}) with owner ${owner.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
