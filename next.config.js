/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // 챔피언/아이템 아이콘을 Riot의 Data Dragon 서버에서 바로 불러오기 위한 설정
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ddragon.leagueoflegends.com',
      },
    ],
  },
};

module.exports = nextConfig;
