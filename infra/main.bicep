targetScope = 'subscription'

@description('A short, unique name for this FamFlix deployment, such as famflix-example.')
param environmentName string
param location string
param tags object = {
  environment: environmentName
  project: 'famflix'
  deploymentMethod: 'bicep'
}

var resourceGroupName = 'rg-${environmentName}'
var staticWebAppName = 'swa-${environmentName}'

// Create resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// Deploy Static Web App
module staticWebApp 'modules/static-web-app.bicep' = {
  name: 'staticWebAppDeployment'
  scope: rg
  params: {
    name: staticWebAppName
    location: location
    skuName: 'Free'
    skuTier: 'Free'
    tags: tags
  }
}

@description('The Static Web App resource ID')
output staticWebAppId string = staticWebApp.outputs.resourceId

@description('The Static Web App default hostname')
output staticWebAppDefaultHostname string = staticWebApp.outputs.defaultHostname

@description('The Static Web App resource name')
output staticWebAppName string = staticWebAppName
