targetScope = 'subscription'

param location string
param sessionId string
param tags object = {
  environment: 'production'
  project: 'famflix'
  managedBy: 'bicep'
  deploymentMethod: 'bicep'
  sessionId: sessionId
}

var resourceGroupName = 'rg-famflix-prod-a85c'
var staticWebAppName = 'swa-famflix-prod-a85c'

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
